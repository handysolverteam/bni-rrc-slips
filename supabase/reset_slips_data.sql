-- WIPE SLIPS DATA (keeps bni_weeks, tenants, tenant_members).
-- Removes members, chapters, all slip tables, import batches, PALMS
-- attendance + comparison stats (006/007) and chat history so you can
-- re-import from scratch. Schema, RLS and policies are untouched --
-- do NOT re-run any migration after this.
--
-- KEPT ON PURPOSE:
--   bni_weeks       the shared Wednesday calendar; re-imports re-link to it by
--                   meeting date, so wiping it just renumbers week labels.
--   tenants         chapter rows (else you lose the app entirely).
--   tenant_members  your login + role; you would land on the "No chapter
--                   access" screen and need an SQL insert to get back in.
--
-- NOTE: requires 002_member_chapters.sql applied (for public.chapters).

TRUNCATE public.chat_messages,
         public.chat_sessions,
         public.slip_referrals,
         public.slip_one_to_ones,
         public.slip_tyfcb,
         public.slip_visitors,
         public.slip_ceus,
         public.member_attendance,
         public.palms_stats,
         public.import_batches,
         public.members,
         public.chapters
RESTART IDENTITY CASCADE;

-- Re-seed the home chapter row on its FIXED id, because members.chapter_id
-- defaults to that id (002_member_chapters.sql) -- without the row, any insert
-- that relies on the default would fail the FK.
-- Keep the name in sync with NEXT_PUBLIC_CHAPTER_NAME (.env.local), otherwise
-- the first import creates a SECOND home chapter under the env's name.
INSERT INTO public.chapters (id, name)
VALUES ('c1000000-0000-4000-8000-000000000001', 'BNI Influencers')
ON CONFLICT (id) DO NOTHING;

-- Verify: every count below must be 0, bni_weeks must be unchanged, and
-- tenants/tenant_members must still hold your rows.
SELECT 'referrals' AS t, COUNT(*) FROM public.slip_referrals
UNION ALL SELECT 'one_to_ones', COUNT(*) FROM public.slip_one_to_ones
UNION ALL SELECT 'tyfcb', COUNT(*) FROM public.slip_tyfcb
UNION ALL SELECT 'visitors', COUNT(*) FROM public.slip_visitors
UNION ALL SELECT 'ceus', COUNT(*) FROM public.slip_ceus
UNION ALL SELECT 'import_batches', COUNT(*) FROM public.import_batches
UNION ALL SELECT 'member_attendance', COUNT(*) FROM public.member_attendance
UNION ALL SELECT 'palms_stats', COUNT(*) FROM public.palms_stats
UNION ALL SELECT 'members', COUNT(*) FROM public.members
UNION ALL SELECT 'chapters (only home)', COUNT(*) FROM public.chapters
UNION ALL SELECT 'chat_sessions', COUNT(*) FROM public.chat_sessions
UNION ALL SELECT 'chat_messages', COUNT(*) FROM public.chat_messages
UNION ALL SELECT 'bni_weeks (KEPT)', COUNT(*) FROM public.bni_weeks
UNION ALL SELECT 'tenants (KEPT)', COUNT(*) FROM public.tenants
UNION ALL SELECT 'tenant_members (KEPT)', COUNT(*) FROM public.tenant_members;

-- ---------------------------------------------------------------------------
-- FULL RESET (only if you also want the chapter + login gone). This leaves you
-- locked out until you re-grant access with the two inserts at the bottom.
-- ---------------------------------------------------------------------------
-- TRUNCATE public.tenant_members, public.tenants
-- RESTART IDENTITY CASCADE;
--
-- INSERT INTO public.tenants (id, name)
-- VALUES ('d1000000-0000-4000-8000-000000000001', 'BNI Influencers')
-- ON CONFLICT (id) DO NOTHING;
--
-- INSERT INTO public.tenant_members (tenant_id, uid, role)
-- VALUES ('d1000000-0000-4000-8000-000000000001', '<YOUR_FIREBASE_UID>', 'admin')
-- ON CONFLICT DO NOTHING;