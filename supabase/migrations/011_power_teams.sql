-- ============================================================
-- 011: Power Teams (BNI "power teams" such as Business Owners B To B).
-- Run AFTER 010. Run ONCE in the Supabase SQL editor (re-runnable).
--
--   * power_teams  — one row per team, per tenant (chapter workspace)
--   * members.power_team_id — the team a member belongs to (blank = none)
--
-- The seed + assignments at the bottom are the Home Chapter's teams from
-- "ASK sheet 2026 - November influencers.pdf" (75 members; Rajesh Aggarwal of Lecon Financial = Rajesh Kumar Agarwal,
-- same email carajesh.radhey@gmail.com, confirmed by the user 2026-11-25).
-- ============================================================

create table if not exists public.power_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists power_teams_tenant_name_uq
  on public.power_teams (tenant_id, lower(name));

alter table public.members
  add column if not exists power_team_id uuid references public.power_teams(id) on delete set null;
create index if not exists members_power_team_idx on public.members (power_team_id);

-- Server-only data: RLS on, NO public policies (the server client uses the service role).
alter table public.power_teams enable row level security;

-- ---------- Home Chapter teams ----------
insert into public.power_teams (tenant_id, name, sort_order) values
  ('d1000000-0000-4000-8000-000000000001', 'HR / Admin / Marketing', 1),
  ('d1000000-0000-4000-8000-000000000001', 'Business Owners B To C', 2),
  ('d1000000-0000-4000-8000-000000000001', 'Business Owners B To B', 3),
  ('d1000000-0000-4000-8000-000000000001', 'Interiors & Furnishings', 4),
  ('d1000000-0000-4000-8000-000000000001', 'Construction', 5)
on conflict do nothing;

-- ---------- Assignments (home-chapter members, matched by name) ----------
-- HR / Admin / Marketing (14)
update public.members m set power_team_id = t.id
  from public.power_teams t
 where t.tenant_id = m.tenant_id and lower(t.name) = lower('HR / Admin / Marketing')
   and m.tenant_id = 'd1000000-0000-4000-8000-000000000001'
   and m.chapter_id in (select id from public.chapters where lower(name) = 'bni influencers')
   and lower(m.name) in (
     'arminderpal singh',
     'abhay mehta',
     'amit chandna',
     'garima agarwal',
     'harshdeep singh chowdhary',
     'hemant suri',
     'kajal nagrath',
     'kompal bhardwaj',
     'neraj k anand',
     'nitin sharma- chef',
     'piyush puri',
     'tanvi dhamija',
     'tarun rajput',
     'vinu vishvanathan'
   );

-- Business Owners B To C (21)
update public.members m set power_team_id = t.id
  from public.power_teams t
 where t.tenant_id = m.tenant_id and lower(t.name) = lower('Business Owners B To C')
   and m.tenant_id = 'd1000000-0000-4000-8000-000000000001'
   and m.chapter_id in (select id from public.chapters where lower(name) = 'bni influencers')
   and lower(m.name) in (
     'arun ahuja',
     'ambika gupta',
     'amit bahl',
     'amit gupta',
     'ashwani kumar',
     'atul mangal',
     'dr. hemesh thakur',
     'kajal gupta',
     'priyatna basu',
     'ramlal sagwal',
     'richa mongia',
     'rushaal panwar',
     'shaifali khanna',
     'shalini chaudhry',
     'shubham pahuja',
     'sunil vashisht',
     'surender singh khangura',
     'usha kumar',
     'vaini mehra',
     'vivek kakar',
     'yoginder kalra'
   );

-- Business Owners B To B (11)
update public.members m set power_team_id = t.id
  from public.power_teams t
 where t.tenant_id = m.tenant_id and lower(t.name) = lower('Business Owners B To B')
   and m.tenant_id = 'd1000000-0000-4000-8000-000000000001'
   and m.chapter_id in (select id from public.chapters where lower(name) = 'bni influencers')
   and lower(m.name) in (
     'rudhir bhalla',
     'ashutosh nagar',
     'komal gupta',
     'nishant tanwar',
     'rahul matharu',
     'rajesh kumar agarwal',
     'ritu chauhan',
     'sandeep deshwal',
     'sanjay jain',
     'suraj yadav',
     'viraj bansal'
   );

-- Interiors & Furnishings (13)
update public.members m set power_team_id = t.id
  from public.power_teams t
 where t.tenant_id = m.tenant_id and lower(t.name) = lower('Interiors & Furnishings')
   and m.tenant_id = 'd1000000-0000-4000-8000-000000000001'
   and m.chapter_id in (select id from public.chapters where lower(name) = 'bni influencers')
   and lower(m.name) in (
     'kunal singh saini',
     'amit tambi',
     'annie jain',
     'ashok bhasin',
     'chandeep singh chhatwal',
     'divya shakti bajaj',
     'kunnal gupta',
     'nitin sharma',
     'pranati bajaj',
     'rahul bajaj',
     'rahul wadhwa',
     'ranjan k sapra',
     'sumit jain'
   );

-- Construction (16)
update public.members m set power_team_id = t.id
  from public.power_teams t
 where t.tenant_id = m.tenant_id and lower(t.name) = lower('Construction')
   and m.tenant_id = 'd1000000-0000-4000-8000-000000000001'
   and m.chapter_id in (select id from public.chapters where lower(name) = 'bni influencers')
   and lower(m.name) in (
     'vipul sharma',
     'abhay goenka',
     'abhishek aggarwal',
     'amitoj singh jolly',
     'keshav verma',
     'monica singh',
     'naveen aggarwal',
     'pramod aggarwal',
     'pranav agarwal',
     'rajesh kumar gupta',
     'ribhu sehgal',
     'rohit chander sethi',
     'rohit kumar',
     'sunil bindra',
     'suryaditya bose',
     'vinod kumar khatri'
   );

