create extension if not exists pgcrypto;

create table if not exists public.invites (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin', 'viewer')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  local_id text unique,
  fingerprint text unique,
  title text not null check (char_length(title) between 1 and 80),
  space text not null check (space in ('study', 'memory', 'life')),
  category text not null,
  tags jsonb not null default '[]'::jsonb,
  summary text not null default '',
  body text not null default '',
  record_date date,
  favorite boolean not null default false,
  progress integer not null default 0 check (progress between 0 and 100),
  media_type text check (media_type in ('PDF', '图片', '视频', '文本', 'Markdown')),
  object_key text unique,
  file_name text,
  file_size bigint check (file_size is null or file_size between 0 and 104857600),
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_created_at_idx on public.notes (created_at desc);
create index if not exists notes_space_idx on public.notes (space);
create index if not exists notes_owner_id_idx on public.notes (owner_id);
create index if not exists invites_active_email_idx on public.invites (email) where status = 'active';

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.invites
  where email = lower(coalesce(auth.jwt()->>'email', ''))
    and status = 'active'
  limit 1
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

create or replace function public.media_usage_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(file_size), 0)::bigint
  from public.notes
  where object_key is not null
    and public.current_app_role() = 'admin'
$$;

revoke all on function public.media_usage_bytes() from public;
grant execute on function public.media_usage_bytes() to authenticated;

alter table public.notes enable row level security;
alter table public.invites enable row level security;

drop policy if exists "invited users read notes" on public.notes;
create policy "invited users read notes" on public.notes for select to authenticated
using ((select public.current_app_role()) in ('admin', 'viewer'));

drop policy if exists "admin inserts notes" on public.notes;
create policy "admin inserts notes" on public.notes for insert to authenticated
with check ((select public.current_app_role()) = 'admin' and owner_id = (select auth.uid()));

drop policy if exists "admin updates notes" on public.notes;
create policy "admin updates notes" on public.notes for update to authenticated
using ((select public.current_app_role()) = 'admin')
with check ((select public.current_app_role()) = 'admin');

drop policy if exists "admin deletes notes" on public.notes;
create policy "admin deletes notes" on public.notes for delete to authenticated
using ((select public.current_app_role()) = 'admin');

drop policy if exists "admin reads invites" on public.invites;
create policy "admin reads invites" on public.invites for select to authenticated
using ((select public.current_app_role()) = 'admin');

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at before update on public.notes
for each row execute function public.touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-media',
  'private-media',
  false,
  104857600,
  array['application/pdf','image/png','image/jpeg','image/webp','video/mp4','video/webm','text/plain','text/markdown']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "invited users view private media" on storage.objects;
create policy "invited users view private media" on storage.objects for select to authenticated
using (bucket_id = 'private-media' and (select public.current_app_role()) in ('admin', 'viewer'));

drop policy if exists "admin uploads private media" on storage.objects;
create policy "admin uploads private media" on storage.objects for insert to authenticated
with check (
  bucket_id = 'private-media'
  and (select public.current_app_role()) = 'admin'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "admin updates private media" on storage.objects;
create policy "admin updates private media" on storage.objects for update to authenticated
using (bucket_id = 'private-media' and (select public.current_app_role()) = 'admin')
with check (bucket_id = 'private-media' and (select public.current_app_role()) = 'admin');

drop policy if exists "admin deletes private media" on storage.objects;
create policy "admin deletes private media" on storage.objects for delete to authenticated
using (bucket_id = 'private-media' and (select public.current_app_role()) = 'admin');

-- After creating/inviting the first administrator in Authentication, run this once:
-- insert into public.invites(email, role, status)
-- values ('your-admin@example.com', 'admin', 'active')
-- on conflict (email) do update set role = 'admin', status = 'active', revoked_at = null;
