# bni-rrc-slips (BNI Week Slips)

Next.js + Supabase app for weekly BNI Report XLS import, slip browsing, and AI chat.

## Setup (fresh Supabase account — 2 files, in order)
1. `npm install`
2. Copy `.env.example` to `.env.local`, fill Supabase URL + keys (+ `GEMINI_API_KEY` for chat).
3. In Supabase SQL editor run `supabase/migrations/001_schema.sql`, then `supabase/seed.sql`.
4. `npm run dev` → `/import` to upload a Report XLS (week is read from the file title).

## Docs
- `docs/PRD.md`, `docs/SYSTEM.md`, `docs/ARCHITECTURE.md`

## Notes
- `.xlsx` preserves bold (bold name = other-chapter member); `.xls`/`.csv` treat all names as same-chapter.
- Tier 1 (inside) → Inside, Tier 2 (outside) → Outside. Detail → other-chapter/thanker chapter text.
- Meetings are every Wednesday; labels read like `7 January 2026 (Week 2)` (ISO week).
