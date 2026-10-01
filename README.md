# bni-rrc-slips (BNI Week Slips)

Next.js + Supabase app for weekly BNI Report XLS import, slip browsing, and AI chat.

## Setup (fresh Supabase account — migrations in order)
1. `npm install`
2. Copy `.env.example` to `.env.local`, fill Supabase URL + keys (+ `GEMINI_API_KEY` for chat).
3. In Supabase SQL editor run `supabase/migrations/001_schema.sql`, `002_member_chapters.sql`, `003_allow_duplicate_slips.sql`, then `supabase/seed.sql`. Existing projects: run any missing migration — 003 drops the slip dedupe indexes so duplicate entries are never skipped.
4. `npm run dev` → `/import` to upload a Report XLS (week is read from the file title).

## Docs
- `docs/PRD.md`, `docs/SYSTEM.md`, `docs/ARCHITECTURE.md`

## Notes
- Bold names are read as other-chapter members from real `.xlsx` and from the client's SpreadsheetML `.xls` files (detected by content, not extension). Plain binary `.xls`/`.csv` carry no formatting — all names count as same-chapter there.
- Tier 1 (inside) → Inside, Tier 2 (outside) → Outside. Detail → other-chapter/thanker chapter text.
- Meetings are every Wednesday; labels read like `7 January 2026 (Week 2)` (ISO week).
