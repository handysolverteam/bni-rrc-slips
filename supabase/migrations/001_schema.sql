-- ============================================================
-- BNI Week Slips — complete database schema (squashed).
-- For a NEW Supabase account run this file FIRST, then seed.sql.
-- Run in the Supabase Dashboard -> SQL Editor. Re-runnable where
-- marked; table creation itself is one-shot (fresh project).
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- Members (chapter master) ----------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  phone text,
  email text,
  company text,
  is_inactive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index members_name_unique on public.members (lower(name));

-- ---------- BNI weeks (every Wednesday; label "7 January 2026 (Week 2)") ----------
create table public.bni_weeks (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  meeting_date date,
  week_no integer,
  created_at timestamptz not null default now()
);
create unique index bni_weeks_week_no_unique on public.bni_weeks (week_no);
create unique index bni_weeks_meeting_date_unique on public.bni_weeks (meeting_date);

-- ---------- Import batches ----------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  bni_week_id uuid references public.bni_weeks(id) on delete set null,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  status text not null default 'completed',
  error_message text,
  created_at timestamptz not null default now()
);

-- ---------- Slip tables ----------
create table public.slip_referrals (
  id uuid primary key default gen_random_uuid(),
  bni_week_id uuid references public.bni_weeks(id) on delete set null,
  from_member_id uuid references public.members(id) on delete set null,
  to_member_id uuid references public.members(id) on delete set null,
  from_name text not null,
  to_name text not null,
  other_chapter_member text,
  inside_outside text check (inside_outside in ('Inside','Outside')),
  from_is_other_chapter boolean not null default false,
  to_is_other_chapter boolean not null default false,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index slip_referrals_dedupe on public.slip_referrals
  (coalesce(bni_week_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(from_name), lower(to_name), coalesce(lower(other_chapter_member),''), coalesce(inside_outside,''));
create index slip_referrals_week_idx on public.slip_referrals (bni_week_id);

create table public.slip_one_to_ones (
  id uuid primary key default gen_random_uuid(),
  bni_week_id uuid references public.bni_weeks(id) on delete set null,
  initiated_by_member_id uuid references public.members(id) on delete set null,
  met_with_member_id uuid references public.members(id) on delete set null,
  initiated_by_name text not null,
  met_with_name text not null,
  other_chapter_member text,
  photo_proof boolean not null default false,
  gains_shared boolean not null default false,
  initiated_by_is_other_chapter boolean not null default false,
  met_with_is_other_chapter boolean not null default false,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index slip_121_dedupe on public.slip_one_to_ones
  (coalesce(bni_week_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(initiated_by_name), lower(met_with_name), coalesce(lower(other_chapter_member), ''));
create index slip_one_to_ones_week_idx on public.slip_one_to_ones (bni_week_id);

create table public.slip_tyfcb (
  id uuid primary key default gen_random_uuid(),
  bni_week_id uuid references public.bni_weeks(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  member_name text not null,
  amount numeric not null default 0,
  other_chapter_member text,
  thanker_name text null,
  thanker_is_other_chapter boolean not null default false,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index slip_tyfcb_dedupe on public.slip_tyfcb
  (coalesce(bni_week_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(member_name), amount, coalesce(lower(other_chapter_member), ''));
create index slip_tyfcb_week_idx on public.slip_tyfcb (bni_week_id);

create table public.slip_visitors (
  id uuid primary key default gen_random_uuid(),
  bni_week_id uuid references public.bni_weeks(id) on delete set null,
  full_name text not null,
  company text,
  email text,
  phone text,
  invited_by_member_id uuid references public.members(id) on delete set null,
  invited_by_name text,
  attending boolean not null default false,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index slip_visitors_dedupe on public.slip_visitors
  (coalesce(bni_week_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(full_name), coalesce(lower(invited_by_name), ''));
create index slip_visitors_week_idx on public.slip_visitors (bni_week_id);

create table public.slip_ceus (
  id uuid primary key default gen_random_uuid(),
  bni_week_id uuid references public.bni_weeks(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  member_name text not null,
  credits numeric not null default 0,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);
create index slip_ceus_week_idx on public.slip_ceus (bni_week_id);

-- ---------- Chat history (Slips AI) ----------
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  sender text not null check (sender in ('user', 'ai')),
  text text not null,
  created_at timestamptz not null default now()
);
create index chat_messages_session_idx on public.chat_messages (session_id, created_at);

-- ---------- Row level security (MVP: public read; writes via service role) ----------
alter table public.members enable row level security;
alter table public.bni_weeks enable row level security;
alter table public.import_batches enable row level security;
alter table public.slip_referrals enable row level security;
alter table public.slip_one_to_ones enable row level security;
alter table public.slip_tyfcb enable row level security;
alter table public.slip_visitors enable row level security;
alter table public.slip_ceus enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

create policy "public read members" on public.members for select using (true);
create policy "public read weeks" on public.bni_weeks for select using (true);
create policy "public read batches" on public.import_batches for select using (true);
create policy "public read referrals" on public.slip_referrals for select using (true);
create policy "public read 121" on public.slip_one_to_ones for select using (true);
create policy "public read tyfcb" on public.slip_tyfcb for select using (true);
create policy "public read visitors" on public.slip_visitors for select using (true);
create policy "public read ceus" on public.slip_ceus for select using (true);
create policy "public read chat_sessions" on public.chat_sessions for select using (true);
create policy "public read chat_messages" on public.chat_messages for select using (true);
