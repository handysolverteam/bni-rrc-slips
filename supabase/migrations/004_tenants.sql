-- ============================================================
-- 004: multi-tenant (one BNI chapter = one tenant).
-- Run AFTER 003_allow_duplicate_slips.sql (and before/with seed.sql
-- on a fresh setup — seed rows land in the default tenant via the
-- column defaults below).
--
-- What it does:
--   1. tenants + tenant_members (manual/SQL provisioning).
--   2. tenant_id on every tenant-scoped table; ALL existing rows are
--      backfilled into the default tenant so nothing is lost.
--   3. Per-tenant unique rules for members and chapters.
--
-- The default tenant's name should match this deployment's chapter
-- (NEXT_PUBLIC_CHAPTER_NAME). Rename it freely later — the name just
-- has to stay unique.
-- ============================================================

-- ---------- Tenants ----------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Home-chapter rule for this tenant (HOME = bold/Detail split). NULL =
    -- fall back to NEXT_PUBLIC_CHAPTER_NAME, then 'BNI Influencer'.
  home_chapter_name text,
  created_at timestamptz not null default now()
);
create unique index tenants_name_unique on public.tenants (lower(name));

-- ---------- User <-> tenant membership (many-to-many) ----------
-- uid = Firebase Auth subject (the no-access screen prints it).
-- role is stored but not enforced yet (everyone acts as admin).
create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  uid text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  primary key (tenant_id, uid)
);
create index tenant_members_uid_idx on public.tenant_members (uid);

-- Server-only data: RLS stays on with NO public policies (the server
-- client uses the service role, which bypasses RLS).
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;

-- ---------- Default tenant (fixed id for the backfill) ----------
insert into public.tenants (id, name)
values ('d1000000-0000-4000-8000-000000000001', 'BNI Influencers')
on conflict (id) do nothing;

-- Grant a signed-in user access (uid is shown on the app's no-access
-- screen; run once per user per chapter):
--   insert into public.tenant_members (tenant_id, uid)
--   values ('d1000000-0000-4000-8000-000000000001', '<uid>')
--   on conflict do nothing;

-- ---------- tenant_id columns + backfill ----------
-- members/chapters keep the default (seed.sql inserts without the
-- column, exactly like 002 did for chapter_id); the import path sets
-- them explicitly.
alter table public.members
  add column if not exists tenant_id uuid
  references public.tenants(id)
  default 'd1000000-0000-4000-8000-000000000001';
update public.members set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.members alter column tenant_id set not null;

alter table public.chapters
  add column if not exists tenant_id uuid
  references public.tenants(id)
  default 'd1000000-0000-4000-8000-000000000001';
update public.chapters set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.chapters alter column tenant_id set not null;

-- Slips / batches / chat sessions: NOT NULL and NO default — every
-- insert must name its tenant (a forgotten tenant_id fails loudly
-- instead of silently leaking rows into the default tenant).
alter table public.slip_referrals
  add column if not exists tenant_id uuid references public.tenants(id);
update public.slip_referrals set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.slip_referrals alter column tenant_id set not null;

alter table public.slip_one_to_ones
  add column if not exists tenant_id uuid references public.tenants(id);
update public.slip_one_to_ones set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.slip_one_to_ones alter column tenant_id set not null;

alter table public.slip_tyfcb
  add column if not exists tenant_id uuid references public.tenants(id);
update public.slip_tyfcb set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.slip_tyfcb alter column tenant_id set not null;

alter table public.slip_visitors
  add column if not exists tenant_id uuid references public.tenants(id);
update public.slip_visitors set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.slip_visitors alter column tenant_id set not null;

alter table public.slip_ceus
  add column if not exists tenant_id uuid references public.tenants(id);
update public.slip_ceus set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.slip_ceus alter column tenant_id set not null;

alter table public.import_batches
  add column if not exists tenant_id uuid references public.tenants(id);
update public.import_batches set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.import_batches alter column tenant_id set not null;

alter table public.chat_sessions
  add column if not exists tenant_id uuid references public.tenants(id);
update public.chat_sessions set tenant_id = 'd1000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.chat_sessions alter column tenant_id set not null;

-- bni_weeks stays GLOBAL (shared ISO-Wednesday meeting calendar).
-- chat_messages inherits the tenant through its session.

-- ---------- Per-tenant uniqueness ----------
drop index if exists public.members_name_chapter_unique;
create unique index members_tenant_name_chapter_unique
  on public.members (tenant_id, lower(name), chapter_id);

drop index if exists public.chapters_name_unique;
create unique index chapters_tenant_name_unique
  on public.chapters (tenant_id, lower(name));

-- ---------- Scoping indexes ----------
create index if not exists members_tenant_idx on public.members (tenant_id);
create index if not exists chapters_tenant_idx on public.chapters (tenant_id);
create index if not exists import_batches_tenant_idx on public.import_batches (tenant_id);
create index if not exists chat_sessions_tenant_idx on public.chat_sessions (tenant_id);
create index if not exists slip_referrals_tenant_week_idx on public.slip_referrals (tenant_id, bni_week_id);
create index if not exists slip_121_tenant_week_idx on public.slip_one_to_ones (tenant_id, bni_week_id);
create index if not exists slip_tyfcb_tenant_week_idx on public.slip_tyfcb (tenant_id, bni_week_id);
create index if not exists slip_visitors_tenant_week_idx on public.slip_visitors (tenant_id, bni_week_id);
create index if not exists slip_ceus_tenant_week_idx on public.slip_ceus (tenant_id, bni_week_id);
