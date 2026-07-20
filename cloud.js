window.CloudApp = (() => {
  const SESSION_KEY = "mori-supabase-session";
  const BUCKET = "private-media";
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const FREE_STORAGE_BUDGET = 1024 * 1024 * 1024;
  const WARNING_THRESHOLD = 0.8;
  let config;
  let session;
  let user;

  function loadSession() { try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { session = null; } }
  function saveSession(value) { session = value; value ? localStorage.setItem(SESSION_KEY, JSON.stringify(value)) : localStorage.removeItem(SESSION_KEY); }
  function authHeaders(json = false) { return { apikey: config.anonKey, authorization: `Bearer ${session?.access_token || config.anonKey}`, ...(json ? { "content-type": "application/json" } : {}) }; }
  async function responseData(response) { const text = await response.text(); const data = text ? JSON.parse(text) : null; if (!response.ok) throw new Error(data?.message || data?.error_description || data?.error || "云端请求失败"); return data; }

  async function init() {
    config = window.__SUPABASE_CONFIG__;
    if (!config?.url || !config?.anonKey || config.url.includes("YOUR_PROJECT")) return { enabled: false };
    config.url = config.url.replace(/\/$/, "");
    loadSession();
    finishCallback();
    if (session?.expires_at * 1000 < Date.now() + 60000) await refresh();
    if (!session?.access_token) return { enabled: true, authenticated: false };
    try {
      const authUser = await responseData(await fetch(`${config.url}/auth/v1/user`, { headers: authHeaders() }));
      const role = await rpc("current_app_role");
      if (!role) throw new Error("此邮箱尚未受邀或权限已撤销");
      user = { id: authUser.id, email: authUser.email, role };
      return { enabled: true, authenticated: true, user };
    } catch {
      saveSession(null);
      return { enabled: true, authenticated: false };
    }
  }

  function finishCallback() {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get("access_token")) {
      const value = Object.fromEntries(hash);
      value.expires_at = Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600);
      saveSession(value);
      history.replaceState({}, "", location.pathname);
    }
  }
  async function refresh() {
    if (!session?.refresh_token) return;
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: config.anonKey, "content-type": "application/json" }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
    if (!response.ok) return saveSession(null);
    const value = await response.json(); value.expires_at = Math.floor(Date.now() / 1000) + value.expires_in; saveSession(value);
  }
  async function sendMagicLink(email) {
    const redirectTo = `${location.origin}${location.pathname}`;
    const response = await fetch(`${config.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", headers: { apikey: config.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, create_user: false }) });
    if (!response.ok) throw new Error("发送失败。请确认管理员已邀请此邮箱。 ");
  }
  async function rest(path, options = {}) {
    if (session?.expires_at * 1000 < Date.now() + 30000) await refresh();
    return responseData(await fetch(`${config.url}/rest/v1/${path}`, { ...options, headers: { ...authHeaders(!!options.body), ...(options.headers || {}) } }));
  }
  async function rpc(name, input = {}) { return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(input) }); }
  async function edge(action, payload = {}) {
    const response = await fetch(`${config.url}/functions/v1/invite-manager`, { method: "POST", headers: authHeaders(true), body: JSON.stringify({ action, ...payload }) });
    return responseData(response);
  }

  const noteFromCloud = n => ({ id:n.id, localId:n.local_id, fingerprint:n.fingerprint, title:n.title, space:n.space, category:n.category, tags:n.tags || [], summary:n.summary, content:n.body, recordDate:n.record_date, favorite:n.favorite, progress:n.progress, type:n.media_type, fileName:n.file_name, fileSize:n.file_size, mimeType:n.mime_type, objectKey:n.object_key, importedAt:new Date(n.created_at).getTime(), createdAt:new Date(n.created_at).getTime(), cloud:true });
  const notePayload = n => ({ local_id:n.localId || null, fingerprint:n.fingerprint || null, title:n.title, space:n.space, category:n.category, tags:n.tags || [], summary:n.summary || "", body:n.content || "", record_date:n.recordDate || null, favorite:!!n.favorite, progress:n.progress || 0, media_type:n.type, object_key:n.objectKey || null, file_name:n.fileName || null, file_size:n.fileSize || null, mime_type:n.mimeType || null });

  async function listNotes() { return (await rest("notes?select=*&order=created_at.desc")).map(noteFromCloud); }
  async function createNote(note) {
    if (note.fingerprint) { const existing = await rest(`notes?fingerprint=eq.${encodeURIComponent(note.fingerprint)}&select=*`); if (existing[0]) return noteFromCloud(existing[0]); }
    try { const rows = await rest("notes?select=*", { method:"POST", headers:{ Prefer:"return=representation" }, body:JSON.stringify(notePayload(note)) }); return noteFromCloud(rows[0]); }
    catch (error) { if (note.objectKey) await deleteObject(note.objectKey).catch(() => {}); throw error; }
  }
  async function updateNote(note) { const rows = await rest(`notes?id=eq.${note.id}&select=*`, { method:"PATCH", headers:{ Prefer:"return=representation" }, body:JSON.stringify(notePayload(note)) }); return noteFromCloud(rows[0]); }
  async function deleteNote(id) { const rows = await rest(`notes?id=eq.${id}&select=object_key`); await rest(`notes?id=eq.${id}`, { method:"DELETE", headers:{ Prefer:"return=minimal" } }); if (rows[0]?.object_key) await deleteObject(rows[0].object_key).catch(() => {}); }

  async function storageUsage() { return Number(await rpc("media_usage_bytes")) || 0; }
  async function upload(file, onProgress = () => {}) {
    if (file.size > MAX_FILE_BYTES) throw new Error("免费测试版限制单个文件不超过 100MB");
    const used = await storageUsage();
    if (used + file.size > FREE_STORAGE_BUDGET) throw new Error("预计会超过 1GB 免费存储预算，已停止上传以避免意外费用");
    if (used + file.size > FREE_STORAGE_BUDGET * WARNING_THRESHOLD) window.dispatchEvent(new CustomEvent("storage-warning", { detail:{ used, incoming:file.size } }));
    const objectKey = `${user.id}/${Date.now()}-${crypto.randomUUID()}-${safeName(file.name)}`;
    const locationUrl = await createTusUpload(objectKey, file);
    let offset = 0; const chunkSize = 6 * 1024 * 1024;
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
      const response = await fetch(locationUrl, { method:"PATCH", headers:{ ...authHeaders(), "content-type":"application/offset+octet-stream", "tus-resumable":"1.0.0", "upload-offset":String(offset) }, body:chunk });
      if (!response.ok) throw new Error(`上传在 ${(offset / 1024 / 1024).toFixed(1)}MB 处中断`);
      offset = Number(response.headers.get("upload-offset") || offset + chunk.size); onProgress(Math.round(offset / file.size * 100));
    }
    return objectKey;
  }
  async function createTusUpload(objectKey, file) {
    const metadata = { bucketName:BUCKET, objectName:objectKey, contentType:file.type || "application/octet-stream", cacheControl:"3600" };
    const encoded = Object.entries(metadata).map(([k,v]) => `${k} ${btoa(unescape(encodeURIComponent(v)))}`).join(",");
    const response = await fetch(`${config.url}/storage/v1/upload/resumable`, { method:"POST", headers:{ ...authHeaders(), "tus-resumable":"1.0.0", "upload-length":String(file.size), "upload-metadata":encoded, "x-upsert":"false" } });
    if (!response.ok) throw new Error("无法初始化媒体上传");
    return new URL(response.headers.get("location"), config.url).href;
  }
  async function mediaUrl(id) {
    const rows = await rest(`notes?id=eq.${id}&select=object_key`); if (!rows[0]?.object_key) throw new Error("媒体不存在");
    const response = await fetch(`${config.url}/storage/v1/object/sign/${BUCKET}/${encodePath(rows[0].object_key)}`, { method:"POST", headers:authHeaders(true), body:JSON.stringify({ expiresIn:300 }) });
    const data = await responseData(response); return data.signedURL.startsWith("http") ? data.signedURL : `${config.url}/storage/v1${data.signedURL}`;
  }
  async function deleteObject(key) { const response = await fetch(`${config.url}/storage/v1/object/${BUCKET}/${encodePath(key)}`, { method:"DELETE", headers:authHeaders() }); if (!response.ok && response.status !== 404) throw new Error("媒体删除失败"); }
  async function fingerprint(note) { const value=[note.fileName || "",note.fileSize || 0,note.lastModified || 0,note.title || ""].join(":");return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,"0")).join(""); }
  const safeName = name => name.toLowerCase().replace(/[^a-z0-9._-]+/g,"-").slice(-100) || "file";
  const encodePath = path => path.split("/").map(encodeURIComponent).join("/");

  return {
    init, sendMagicLink, logout(){ saveSession(null); location.reload(); }, get user(){ return user; }, get isAdmin(){ return user?.role === "admin"; },
    listNotes, createNote, updateNote, deleteNote,
    listInvites:() => edge("list"), invite:email => edge("invite", { email }), revoke:email => edge("revoke", { email }),
    upload, mediaUrl, storageUsage, fingerprint, notePayload, MAX_FILE_BYTES, FREE_STORAGE_BUDGET
  };
})();
