-- 005: RBAC (admin | member) + per-user chat ownership.
-- Run in the Supabase SQL editor (same as 004). Idempotent — safe to re-run.
--
-- Roles (enforced by the app, lib/server-auth.ts):
--   'admin'  = full access: import, browse, export, chat (default; create admins directly in Supabase)
--   'member' = read-only chapter data + own chat (no import)
--
--   insert into public.tenant_members (tenant_id, uid, role)
--   values ('d1000000-0000-4000-8000-000000000001', '<firebase-uid>', 'admin');
--
-- Chat sessions belong to exactly one user: every browser session only ever
-- lists/reads/writes sessions with owner_uid = its uid (admins included).
-- Service-role callers without a uid stay root (tests/scripts see all).

-- 1) Roles: constrain the free-text column to the two supported values.
alter table public.tenant_members
  drop constraint if exists tenant_members_role_check;
alter table public.tenant_members
  add constraint tenant_members_role_check check (role in ('admin', 'member'));

-- 2) Per-user chats: owner column + index.
alter table public.chat_sessions
  add column if not exists owner_uid text;

-- Legacy sessions (created before 005) belong to the tenant's earliest
-- provisioned account — in practice the chapter admin who owns the history.
update public.chat_sessions s
set owner_uid = (
  select tm.uid
  from public.tenant_members tm
  where tm.tenant_id = s.tenant_id
  order by tm.created_at asc
  limit 1
)
where s.owner_uid is null;

create index if not exists chat_sessions_tenant_owner_idx
  on public.chat_sessions (tenant_id, owner_uid);
