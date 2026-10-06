# AGENTS.md

## Standing conventions

1. **Home Chapter is the default reference.** When a request or question does
   not name a chapter, answer and build for the **Home Chapter** — the default
   tenant `d1000000-0000-4000-8000-000000000001` (`BNI Influencers`). Any other
   chapter is an explicit exception the user must name. Never design a flow
   where the Home Chapter needs manual per-user setup while another chapter
   does not; the reverse is fine.

2. **App users vs BNI members are different things.**
   - `members` = people created by XLS import; their chapter is derived by
     `lib/member-chapters.ts` (bold/Detail chapter, else home). Never manual.
   - `tenant_members` = app users (Firebase uids) mapped to a chapter.

## Repo facts

- Default/home tenant: `d1000000-0000-4000-8000-000000000001`, name
  `BNI Influencers`, `home_chapter_name` NULL → home falls back to
  `NEXT_PUBLIC_CHAPTER_NAME`.
- **No roles.** Roles (admin/member) were removed on 2026-10-05: every member
  of a tenant can import, browse, export, toggle members and chat. Only sign-in
  and membership are enforced, in `lib/server-auth.ts`. `tenant_members.role`
  (migration 005) is still in the DB but unused, so roles can be re-applied later.
- Sign-in is Google (email) only; `app/login/page.tsx` has no phone/OTP flow.
- **Open sign-in**: the first sign-in auto-grants the **Home Chapter**
  (`lib/tenant-grant.ts`, idempotent upsert) — no SQL per user. Membership in
  any *other* chapter stays a manual SQL insert.
- Migrations `001`–`007` are applied (006 = `member_attendance` for the PALMS
  Chapter Summary import, 007 = `palms_stats` for the PALMS-vs-slips
  comparison). No `DATABASE_URL` in `.env.local`, so the
  user runs any new DDL in the Supabase SQL editor.
- Build = `npm run build`; e2e suites in `tests/` need the prod server on
  :3000 (`npm run start`).

## Flow

Docs (`docs/PRD.md` → `docs/SYSTEM.md` → `docs/ARCHITECTURE.md`) before code;
minimal diffs; no commits unless asked.