# bni-rrc-slips (BNI Week Slips)

Next.js + Supabase app for weekly BNI Report XLS import, slip browsing, and AI chat.

## Setup (fresh Supabase account — migrations in order)
1. `npm install`
2. Copy `.env.example` to `.env.local`, fill Supabase URL + keys (+ `GEMINI_API_KEY` for chat).
3. In Supabase SQL editor run `supabase/migrations/001_schema.sql`, `002_member_chapters.sql`, `003_allow_duplicate_slips.sql`, `004_tenants.sql`, `005_rbac.sql`, then `supabase/seed.sql`. Existing projects: run any missing migration — 003 drops the slip dedupe indexes, 004 adds tenant scoping and backfills all existing rows into the default tenant, 005 adds the (now unused) role column and per-user chat ownership.
4. `npm run dev` → `/import` to upload a Report XLS (week is read from the file title).
5. Sign in with Google — the **Home Chapter is granted automatically on first sign-in**, so a brand-new account works with zero setup. (The "No chapter access yet" screen only appears if that grant fails, e.g. the Home Chapter `tenants` row is missing — its SQL fixes that.)

## Multi-tenant (one BNI chapter = one tenant)
- Data is scoped by `tenant_id`; the active chapter comes from the `bni_tenant` cookie (switcher in the header). `bni_weeks` (the Wednesday calendar) stays global.
- **Open sign-in**: the Home Chapter auto-grants every Google account on its first sign-in — no admin UI, no SQL, no per-user setup. Another chapter = a new `tenants` row + `tenant_members` rows for its users (SQL shown in `004_tenants.sql`).
- **No roles**: every member of a chapter can import, browse, export, toggle members and chat — only sign-in and chapter membership are enforced. `tenant_members.role` (migration 005) is left in the DB but unused, so roles can be re-applied later without new DDL.
- **Per-user chats**: each `chat_sessions.owner_uid` sees only their own sessions/messages; chats still stay inside the tenant.
- **Active/inactive members**: `/members` shows an `Active` checkbox before Name for everyone — unchecking marks the member inactive (`members.is_inactive`, active by default, never touched by import) via `PATCH /api/members/{id}` (tenant-scoped). Everyone also sees inactive rows. Flagging someone inactive deletes nothing (slips/exports/chat keep working).
- **Chat**: the composer's suggested questions follow the conversation (each reply proposes the next follow-ups; a fresh chat falls back to the starters), and **Share chat** (toolbar) or **Share to WhatsApp** (message ⋮ menu) open WhatsApp prefilled with the transcript/message through `wa.me` — the member picks the recipient and nothing leaves the app until they send it.

## Tests (e2e — server must be running on :3000)
- `node tests/e2e-import-members.mjs` — import rules + screens (floor: 213 slips in week 40).
- `node tests/e2e-chat-weekly.mjs` — chat answers from live data + suggestion chips (10 checks; Gemini quota may retry).
- `node tests/e2e-tenant-isolation.mjs` — cross-tenant rows never leak (requires migration 004).
- `node tests/e2e-chat-ownership.mjs` — per-user chats + the open active/inactive toggle (requires migration 005).
- `node tests/unit-autogrant.mjs` — open sign-in: Home Chapter granted on first visit, idempotent (no server needed; writes and removes one fake `tenant_members` row).
- `node tests/unit-whatsapp.mjs` — WhatsApp share link/transcript formatting (no server needed; Node ≥ 22.18 imports the `.ts` source directly).
- The four e2e suites call the API as server-to-server callers (`Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY`, tenant via `x-tenant-id` or the default tenant); the chat test additionally sends `x-user-uid` to act as a specific user (service callers are never auto-granted, which is how it probes `noAccess`).

## Docs
- `docs/PRD.md`, `docs/SYSTEM.md`, `docs/ARCHITECTURE.md`

## Notes
- Bold names are read as other-chapter members from real `.xlsx` and from the client's SpreadsheetML `.xls` files (detected by content, not extension). Plain binary `.xls`/`.csv` carry no formatting — all names count as same-chapter there.
- Tier 1 (inside) → Inside, Tier 2 (outside) → Outside. Detail → other-chapter/thanker chapter text.
- Meetings are every Wednesday; labels read like `7 January 2026 (Week 2)` (ISO week).
