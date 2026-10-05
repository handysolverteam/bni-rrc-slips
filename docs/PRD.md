# PRD — BNI Week Slips (MVP)

## Purpose
Import a weekly BNI `Report` XLS (columns: From, To, Slip Type, Inside/Outside, TYFCB, CEU Credits, Detail) and browse it in 6 read-only screens matching the legacy app.

## Core workflow (MVP only)
1. User opens `/import` and selects the `.xls/.xlsx` Report file. The meeting week is read from the file's title row (e.g. `Slips Audit Report for 01/04/2026`).
2. App POSTs the file to `/api/import/report`.
3. Server parses, upserts members/weeks, inserts slips, returns `{ imported, skipped, errors }`.
4. User browses 6 read-only paginated screens:
   - `/members` — Bni Member (Active, Name, Chapter, Category, Company, Phone — Category/Company/Phone are empty placeholders until CRUD; the Active column is an admin-only active/inactive toggle)
   - `/referrals` — Slip Referrals (BNI Week, Referral From, Referral To, Other Member's Chapter, Inside/Outside)
   - `/one-to-ones` — Slip 121 (BNI Week, Initiated By, Met With, Other Member's Chapter, Photo Proof, Gains Shared)
   - `/visitors` — Slip Visitors (Full Name, Company, Invited By, BNI Week, Email, Phone, Attending, etc.)
   - `/tyfcb` — Slip TYFCB (BNI Week, BNI Member, Amount, Thanking Member's Chapter)
   - `/ceus` — Slip CEU (BNI Week, BNI Member, CEU Credits)
   - `/report` — Week Report: one section/tab per slip type (One-to-One, Referrals, TYFCB, Visitors, CEU) with filters and xlsx/csv/pdf export.

No CRUD in MVP. CRUD later.

## Active / inactive members
- Every member is **active by default** (`members.is_inactive` defaults to false); import never marks anyone inactive, and historical rows stay exactly as imported.
- The `/members` table gets an **Active toggle in the first column, before Name**.
- **Admins** see the toggle and can mark a member active/inactive in place (no edit page). They also **see inactive members** in the list.
- **`member` role users see only active members** — both the toggle column and the inactive rows are hidden for them.
- Marking someone inactive never deletes anything: their slips, chat answers, exports and member row all stay; it only removes them from the member list for read-only users.

## XLS mapping assumptions (explicit — bold not readable by `xlsx`)
Source columns: `From | To | Slip Type | Inside/Outside | TYFCB | CEU Credits | Detail`.

- `Slip Type` values handled: `One-to-One`, `Referral`, `TYFCB`, `Visitor`, `CEU` (case-insensitive, trimmed). Unknown/blank → skipped + reported.
- `Inside/Outside`: `Tier 1 (inside)` → `Inside`, `Tier 2 (outside)` → `Outside` (also accepts plain `inside/outside/1/2`). TYFCB rows leave this blank in source → stored NULL.
- `Detail`: the chapter of the BOLD name on that row — blank Detail → the tenant's home chapter (see Member master rule below). Displayed as Other Member's Chapter text on the slip for display.
- **Bold rule (confirmed)**: a BOLD name belongs to a DIFFERENT chapter; the Detail column describes that bold person's chapter. Non-bold names are same-chapter members and are the only ones added to the member master. Implemented for `.xlsx` via ExcelJS (`lib/report-bold.ts`): bold From/To set `from/to_is_other_chapter` and skip member creation (name text is still stored on the slip). Legacy `.xls`/`.csv` carry no formatting info — save as `.xlsx` to preserve bold.
- `Referral`: From → `referral_from`, To → `referral_to`.
- `One-to-One`: From → `initiated_by`, To → `met_with`. Counting rule: a meeting with a BOLD (other-chapter) side counts 1; a meeting between two home members counts 2 (home card, report stat/badge/grand total, chat total). Lists and exports still show one row per slip.
- `TYFCB`: From is normally blank — the anonymous thanker. To = member being thanked, always home (even if bold; the bold flag is kept for display). Detail names the anonymous thanker's other chapter. A named non-bold thanker files home; a bold one is skipped.
- `Visitor`: From = Invited By (sponsor), To = visitor full name. Company/Email/Phone not in Report XLS → NULL placeholders for now.
- `CEU`: From = member, CEU Credits = credits (meetings attended). Stored in `slip_ceus`; shown on `/ceus` and as the Report CEU section/tab. The attendee always files HOME — the bold rule does not apply to CEU rows.
- Member master: one row per (name, chapter) — the same name may belong to multiple chapters (as member, visitor, referral party, …) and is never merged across them. Bold names file into their Detail chapter (created in Supabase when it does not exist yet); all other names file into the tenant's **home chapter**: the tenant's `home_chapter_name` when configured, else `NEXT_PUBLIC_CHAPTER_NAME` **only for BNI Influencers** (any other chapter never inherits the env chapter), else the tenant's own name. Existing rows for that chapter are reused; existing rows are never moved. Visitor full names are never added (only non-bold inviters).

## Success criteria
- Upload Report XLS + week → rows appear in correct 6 screens with pagination (150/page default like screenshots).
- Every file entry is correct: duplicate entries (identical rows, or re-importing the same week) are imported as-is — nothing is skipped for being a duplicate (`supabase/migrations/003_allow_duplicate_slips.sql` drops the per-week dedupe indexes). Only typing mistakes (unknown Slip Type, missing From/To, a number instead of a name) pause the import with a confirmation dialog; those rows are skipped only after the user agrees.
- `npm run build` passes.

---

# Multi-tenant release (chapter = tenant)

## Purpose
One deployment now serves many BNI chapters. Each chapter is a **tenant** with fully isolated members, slips, imports, reports and chats. Users sign in through the existing Handychapter Google SSO and can belong to several chapters.

## Definitions
- **Tenant** = one BNI chapter (the isolation boundary for all data).
- **Membership** = a signed-in user (Firebase uid) belongs to a tenant. Many-to-many: one user → many tenants, one tenant → many users. Each membership carries a **role**: `admin` or `member`.
- **Active tenant** = the chapter the app is currently showing; chosen explicitly via the switcher, remembered across visits.
- **Role** = what the user may do inside their active tenant:
  - `admin` — full access: import report files, browse every screen, export, chat. Created directly in Supabase (SQL insert), default role.
  - `member` — read-only: browse all screens, export, and chat about their own conversations; no import (the import APIs, `/import` page and import buttons are hidden/denied). Created directly in Supabase with `role 'member'`.

## Core workflow
1. User signs in as today (Google SSO on `/login`).
2. App looks up the user's memberships.
   - **No memberships** → a "No chapter access" screen shows the user's uid and the exact SQL an operator runs to grant access (provisioning stays manual/SQL — no admin UI in this release).
   - **One membership** → that tenant is active automatically.
   - **Several memberships** → last active tenant is restored; otherwise the first one. A **chapter switcher** in the top nav lists the user's tenants and switches on click.
3. Every screen (6 lists, `/report`, `/import`, `/chat`) and every API call operates ONLY on the active tenant's data: member list, week lists, slip rows, export files, import batches, chat sessions/answers.
4. Import (admins only) writes members/slips/batches tagged with the active tenant; re-importing the same file into another tenant creates that tenant's own rows (shared nothing).
5. Chat answers only about the active tenant's slips; switching chapter switches the chat history to that chapter's sessions. The suggested-question chips under the composer follow the conversation: after each answer the AI proposes the next questions from what was just discussed (a fresh chat shows the generic starter questions).
6. Chats are **per user**: every user only ever sees their own chat sessions and messages (including admins); chapter data remains shared by role.
7. Unauthenticated API/page access is rejected (401 / redirect to `/login`). A signed-in user can only ever read or write tenants they are a member of.
8. Role is checked on every write: a `member` gets **403** from `POST /api/import/preview` and `POST /api/import/report`, the `/import` page redirects them home, and the Import nav/home/report buttons do not render for them.

## Success criteria (multi-tenant)
- **Isolation**: data from two tenants never mixes — member/week/slip/report/import/chat queries are scoped to the active tenant (verified by an isolation test).
- **Auth**: API routes without a valid session return 401; pages redirect to `/login`; a member of tenant A cannot read tenant B even with a hand-crafted request (active-tenant cookie is validated against memberships).
- **Switcher**: switching chapter updates every screen's data, the week filters, and the chat history; the choice survives a reload.
- **Backfill**: all pre-existing data remains visible (it becomes the default tenant), nothing lost, no duplicate rows.
- **Provisioning**: a brand-new user with no membership gets the no-access screen with their uid; one SQL insert grants them a chapter (`role 'admin'` default, `'member'` for read-only).
- **RBAC**: an `admin` imports and sees all import UI; a `member` gets 403 from both import APIs, never sees the Import nav/home/report buttons, and is redirected off `/import` (verified by an rbac test).
- **Per-user chats**: two users in the same tenant never see each other's chat sessions/messages (verified by an rbac test); chats still stay inside their tenant (isolation test).
- `npm run build` passes and the existing chat/import e2e tests still pass.

## Share a chat to WhatsApp
- From `/chat`, a member can hand a conversation over to WhatsApp — typically to forward an answer to a chapter member who does not use the app.
- Two ways, both opening WhatsApp with the text already written; the member picks the recipient themselves and nothing is sent until they press send in WhatsApp:
  - **Share chat** (chat toolbar) — the whole conversation as a transcript headed by the chat's title, each turn labelled `You:` / `Slips AI:`. The bot's auto-intro line is left out. Ordinary conversations are always shared in full; only a transcript too long for a WhatsApp link (over 20 000 characters, i.e. very long chats) drops its oldest turns, and the toolbar says so **before** sharing ("will send the newest N of M messages").
  - **Share to WhatsApp** (a message's ⋮ menu) — only that one message.
- Sharing is read-only and stays in the browser: nothing is posted, stored or re-sent by the app.

## Out of scope (this release)
- In-app tenant admin (create tenant / invite users / change roles in the UI), self-serve signup, RLS policy rework, billing, per-tenant branding/env (the `NEXT_PUBLIC_CHAPTER_NAME` home-chapter rule moves to the tenant record). Role changes are SQL updates for now.
