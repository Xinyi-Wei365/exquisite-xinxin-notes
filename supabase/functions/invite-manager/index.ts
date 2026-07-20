import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const siteUrl = Deno.env.get("SITE_URL") || "";
const siteOrigin = siteUrl ? new URL(siteUrl).origin : "";
const cors = {
  "Access-Control-Allow-Origin": siteOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  if (origin && siteOrigin && origin !== siteOrigin) return reply({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = request.headers.get("Authorization") || "";
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user?.email) return reply({ error: "Unauthorized" }, 401);

  const { data: role } = await caller.rpc("current_app_role");
  if (role !== "admin") return reply({ error: "Admin only" }, 403);

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "list") {
    const { data, error } = await admin.from("invites").select("email,role,status,created_at,revoked_at").order("created_at", { ascending: false });
    return error ? reply({ error: error.message }, 400) : reply(data);
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "Invalid email" }, 400);
  if (email === user.email.toLowerCase() && action === "revoke") return reply({ error: "Cannot revoke yourself" }, 400);

  if (action === "invite") {
    const redirectTo = String(Deno.env.get("SITE_URL") || "");
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteError && !inviteError.message.toLowerCase().includes("already")) return reply({ error: inviteError.message }, 400);
    const { data, error } = await admin.from("invites").upsert({ email, role: "viewer", status: "active", invited_by: user.id, revoked_at: null }, { onConflict: "email" }).select().single();
    return error ? reply({ error: error.message }, 400) : reply(data, 201);
  }

  if (action === "revoke") {
    const { error } = await admin.from("invites").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("email", email).neq("role", "admin");
    return error ? reply({ error: error.message }, 400) : new Response(null, { status: 204, headers: cors });
  }

  return reply({ error: "Unknown action" }, 400);
});
