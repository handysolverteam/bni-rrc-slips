-- ============================================================
-- 006: PALMS attendance (Chapter Summary import).
-- Run AFTER 005_rbac.sql.  Run ONCE in the Supabase SQL editor.
--
-- Stores the per-member ATTENDANCE columns of BNI's
-- Chapter Summary PALMS Report (.xls) for ONE meeting date:
--   P = Present, A = Absent, L / M / S / T = raw PALMS letters.
-- The slip-derived columns (RGI/RGO/RRI/RRO, V, 1-2-1, TYFCB, CEU)
-- are NOT stored — the app computes those from the slips, so the
-- Chapter Summary always agrees with the report cards.
--
-- One row per (tenant, meeting week, member); a re-import of the
-- same PALMS file replaces that week's rows.
-- ============================================================

create table if not exists public.member_attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bni_week_id uuid not null references public.bni_weeks(id) on delete cascade,
  -- Stored exactly as displayed in PALMS ("First Last").
  member_name text not null,
  present integer not null default 0,
  absent  integer not null default 0,
  l integer not null default 0,
  m integer not null default 0,
  s integer not null default 0,
  t integer not null default 0,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One row per (tenant, week, member); expression because names are
-- matched case-insensitively (a re-import replaces that week's rows).
create unique index if not exists member_attendance_week_member_uq
  on public.member_attendance (tenant_id, bni_week_id, lower(member_name));

create index if not exists member_attendance_tenant_week_idx
  on public.member_attendance (tenant_id, bni_week_id);

-- Server-only data: RLS on, NO public policies (the server client uses
-- the service role, which bypasses RLS — same as tenants/tenant_members).
alter table public.member_attendance enable row level security;
