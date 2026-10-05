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
- Roles are enforced server-side in `lib/server-auth.ts`: `admin` = everything,
  `member` = read-only data + own chat.
- Sign-in is Google (email) only; `app/login/page.tsx` has no phone/OTP flow.
- Migrations `001`–`005` are applied. No `DATABASE_URL` in `.env.local`, so the
  user runs any new DDL in the Supabase SQL editor.
- Build = `npm run build`; e2e suites in `tests/` need the prod server on
  :3000 (`npm run start`).

## Flow

Docs (`docs/PRD.md` → `docs/SYSTEM.md` → `docs/ARCHITECTURE.md`) before code;
minimal diffs; no commits unless asked.