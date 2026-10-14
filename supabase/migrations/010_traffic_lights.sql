-- ============================================================
-- 010: BNI Traffic Lights reference rows (the /traffic-lights screen).
-- Run AFTER 009_chat_owner_name.sql.  Run ONCE in the Supabase SQL editor.
--
-- The screen COMPUTES every member's score from the slips + PALMS attendance.
-- Two inputs cannot be rebuilt faithfully from those, so BNI's own monthly
-- "Member Traffic Lights" Excel is imported here and used as:
--   * the source of VISITORS (BNI credits more visitors than our slip
--     inviter names show) and SPONSORS (not in the slips at all), and
--   * a reference total shown next to ours (matches / differs).
--
-- One row per (tenant, report month, member as written in BNI's file);
-- re-importing a month replaces that month's rows.
-- ============================================================

create table if not exists public.bni_traffic_lights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- First day of the report month ("… FOR SEPTEMBER '26" -> 2026-09-01).
  report_month date not null,
  -- Stored exactly as BNI prints it ("Ranjan  Sapra", no middle initial).
  member_name text not null,
  chapter text,
  total_score integer not null default 0,
  attendance_rate numeric,
  attendance_score integer not null default 0,
  ceu_rate numeric,
  ceu_score integer not null default 0,
  one_to_one_rate numeric,
  one_to_one_score integer not null default 0,
  referrals_rate numeric,
  referrals_score integer not null default 0,
  tyfcb numeric,
  tyfcb_score integer not null default 0,
  visitors integer not null default 0,
  visitor_score integer not null default 0,
  sponsors integer not null default 0,
  sponsor_score integer not null default 0,
  filename text,
  created_at timestamptz not null default now()
);

create unique index if not exists bni_traffic_lights_month_member_uq
  on public.bni_traffic_lights (tenant_id, report_month, lower(member_name));

create index if not exists bni_traffic_lights_tenant_month_idx
  on public.bni_traffic_lights (tenant_id, report_month);

-- Server-only data: RLS on, NO public policies (the server client uses the
-- service role, which bypasses RLS — same as tenants / member_attendance).
alter table public.bni_traffic_lights enable row level security;
