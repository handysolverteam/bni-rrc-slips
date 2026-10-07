# ARCHITECTURE — BNI Week Slips

```
bni-rrc-slips/
  docs/PRD.md SYSTEM.md ARCHITECTURE.md
  supabase/migrations/001_schema.sql     # full schema (single file)
                  002_member_chapters.sql
                  003_allow_duplicate_slips.sql
                  004_tenants.sql        # multi-tenant: tenants, tenant_members, tenant_id columns + backfill
                  005_rbac.sql           # applied, role column now UNUSED (roles removed); still owns chat_sessions.owner_uid (per-user chats)
                  006_attendance.sql     # member_attendance — PALMS P/A/L/M/S/T per member per week (Chapter Summary)
                  007_palms_stats.sql    # palms_stats — PALMS Total-row counts per week (PALMS-vs-slips comparison)
  supabase/seed.sql                      # 74 members + Wednesdays Jan 2026-Dec 2027
  lib/
    supabase/server.ts   # getSupabaseServer (service_role on server, anon fallback)
    server-auth.ts       # getTenantContext() -> {uid, tenantId} | noAccess | null (no roles); service callers may pass x-user-uid
    tenant-grant.ts      # grantHomeChapter(sb, uid) -> Home tenant id | null; open sign-in (auto-grant, idempotent)
    report-import.ts     # parseReportFile(buffer) -> rows; mapInsideOutside(); pure, tested
    palms-import.ts      # parsePalmsFile(buffer) -> { meetingDate, members[], palmsTotals }; pure (Chapter Summary PALMS .xls)
    palms-compare.ts     # fetchPalmsComparisons(tenantId, weekIds) — PALMS Total-row stats vs live slip counts, per week
    data-health.ts       # missingWednesdays(importedDates, todayIso) (pure) + fetchMissingMeetingFiles(tenantId)
                         # + fetchUnimportedData(tenantId, weekIds) - weeks missing their slips and/or PALMS file
    report-view.ts       # fetchReportSections(tenantId, ...) — all report/export queries
    summary-view.ts      # fetchChapterSummary(tenantId, weekIds) — member-wise attendance + slip metrics;
                         # SUMMARY_COLS + summaryCell shared by the screen and the summary export
    trends.ts            # fetchSlipTrends(tenantId, months = 6) — weekly (Wednesday) slip counts per type, home dashboard
    list-filters.ts lists.ts distinct.ts server-weeks.ts  # every query takes/uses tenantId
    member-chapters.ts   # resolveHomeChapter(tenant) — home_chapter_name ?? env (default tenant only) ?? tenant.name
    chat/snapshot.ts     # getSlipsData(tenantId) — per-tenant snapshot, cache key includes tenant_id
    firebase/admin.ts    # verifyFirebaseIdToken (jose JWKS) — used by the session cookie route
    types.ts
  app/
    layout.tsx + globals.css (AuthProvider + AppShell guard; AppShell posts ID token -> session cookie)
    api/auth/session/route.ts   # POST {idToken} set HttpOnly bni_session | DELETE clear
    api/tenant/route.ts         # GET current+list | POST {tenantId} switch (membership-checked)
    api/import/report/route.ts         # POST file — slips import (week from the file title)
    api/import/palms/route.ts          # POST file — PALMS attendance import (single meeting date); DELETE ?week — remove that week's attendance/stats
    api/import/batches/[id]/route.ts   # DELETE — remove one import row + every row it created (slips or PALMS attendance/stats)
    api/summary/export/route.ts        # GET week,format=xlsx|csv|pdf|json — Chapter Summary export (screen parity)
    api/report/export/route.ts         # GET week,tab,format=xlsx|csv|pdf|json — week report export (xlsx = ExcelJS with bold From/To cells; json feeds the in-browser PDF)
    api/<resource>/route.ts     # every data API: getTenantContext() first (401 without session)
    api/members/[id]/route.ts   # PATCH {isInactive} — active/inactive toggle (tenant-scoped, any member)
    members|referrals|one-to-ones|visitors|tyfcb|ceus|report|summary|import|chat pages (server components
                                 call getTenantContext() -> redirect /login, noAccess -> no-access screen)
  components/ImportPage.tsx     # import screen: ImportPanel (slips) + PalmsImportPanel (attendance, two-step) + TWO history tables (slips / PALMS) with per-row Delete (ConfirmDialog)
  components/PalmsImportPanel.tsx # two-step upload (choose file -> explicit Import button) -> POST /api/import/palms; mounted on /import, /summary AND /report; on /summary also shows the imported file + Remove action
  components/DataWarnings.tsx   # server component: missing-Wednesday banner + PALMS-mismatch banner (warnings only, nothing on success)
  components/PalmsComparisonTable.tsx # metric | PALMS | Slips | status table (summary screen, at the bottom)
  components/SummaryExportButtons.tsx # xlsx/csv/pdf switch on the summary page head (PDF built in-browser from JSON)
  components/TenantSwitcher.tsx # chapter switcher in the top nav (GET/POST /api/tenant)
  components/SlipsTable.tsx     # shared read-only table + pagination
  components/ListShell.tsx      # shared list frame: title + count badge + optional sub line (active/inactive counts) + Active checkbox filter passed into the table's Active header cell (members list)
  components/MemberActiveToggle.tsx # checkbox in the Active column (members list only)
  components/TrendChart.tsx  # client multi-view trend chart on the home dashboard: slip-type tabs (All = combined + the 5 types) + chart picker (line/bar/area/pie/bubble/radar/heat map) above the graph, 7 hand-rolled SVG renderers + legend from one { weeks, series } prop
```

## Data flow

**Session** — login (Google SSO) → AuthContext has a Firebase user → AppShell `POST /api/auth/session { idToken }` → server verifies via JWKS → HttpOnly cookie `bni_session` (re-posted on every app load, so a long-lived tab stays authenticated).

**Tenant** — every page render / API call → `getTenantContext()`:
1. verify `bni_session` cookie → `uid`
2. read `bni_tenant` cookie → membership lookup in `tenant_members` (falls back to first membership)
3. `{ uid, tenantId }` → all Supabase queries add `.eq("tenant_id", tenantId)`; chat queries add `.eq("owner_uid", uid)`; `null` → 401 / redirect `/login`; **zero memberships on the browser path → the Home Chapter is granted automatically** (`lib/tenant-grant.ts` idempotent upsert) so sign-in is open to everyone — only if that grant fails does the UI fall back to the no-access screen (uid + provisioning SQL).

**Switch** — TenantSwitcher → `POST /api/tenant { tenantId }` (403 if not a member) → cookie set → full reload → every server render re-scopes (lists, weeks, report, import batches, chat snapshot/sessions).

**Import** — upload → tenant-scoped batch/members/chapters/slips inserts → snapshot cache invalidated → report/chat immediately reflect the new rows for that tenant only. **Deletion** — `DELETE /api/import/batches/{id}` (history table) removes that batch's slip rows or PALMS attendance/stats + the batch itself; `DELETE /api/import/palms?week=` (the `/summary` panel's Remove action) clears a week's attendance/comparison without touching slips. Both are tenant-scoped (404 for foreign ids) and clear the caches the import sets.

**Chapter Summary (attendance)** — upload `Chapter Summary PALMS Report` (.xls, two-step panel on `/import`, `/summary` **or** `/report` — choose file, then press Import) → `lib/palms-import.ts` parses `From/To` (single date only) + member rows + the `Total` row's slip counts → week must exist on the calendar (**slips not required** — either file may come first; a missing side yields a red `warning` notice, never a blocked import) → `member_attendance` rows replaced and `palms_stats` upserted for that week → `/summary` (`lib/summary-view.ts`) joins attendance with slip-derived per-member metrics (computed live with the report's home/bold rules) so its Total row always equals the report cards. **Export** — `components/SummaryExportButtons.tsx` → `GET /api/summary/export` → the same `fetchChapterSummary` → xlsx/csv on the server, PDF built in-browser from `format=json` (same byte-swallowing workaround as the report), cells identical to the screen; the PALMS-vs-slips comparison table stays screen-only (not exported).

**Data health** — on every `/report` and `/summary` render: (1) `lib/data-health.ts` lists Wednesdays from the tenant's first imported meeting to today without an imported slips file → amber banner; (2) `lib/palms-compare.ts` compares each selected week's stored `palms_stats` (PALMS `Total` row) with its live slip counts → warning banner listing week/metric/both values (weeks without imported slips are skipped — nothing to compare); (3) `lib/data-health.ts: fetchUnimportedData` lists each week in scope missing its slips file and/or its PALMS summary → red **"… not imported yet"** banner (`components/DataWarnings.tsx`, warnings only — nothing renders when everything is imported). `/summary` renders the side-by-side `PalmsComparisonTable` at the bottom of the page (below the member table); `app/import/loading.tsx` and `app/summary/loading.tsx` show the matching `ImportSkeleton` / `SummarySkeleton` during route navigation.

**Home dashboard** — `/` runs `lib/trends.ts: fetchSlipTrends` server-side (last 6 months of Wednesdays from the global calendar + per-table slip counts) and renders `components/TrendChart.tsx` (client) with `{ weeks, series }` props; the chart keeps `type` (All combined | one slip type) and `chart` (line, bar, area, pie, bubble, radar, heat map) as its own client state in a `.tabs-row` above the graph — every view derives from the same props, so switching tabs/chart types never re-fetches; the old section-card grid and note card are gone — the top nav is the entry point to every list screen.

**Active/inactive member** — `members.is_inactive` (default false = active; import never sets it). Every user gets an `Active` checkbox column before Name → optimistic flip → `PATCH /api/members/{id}` (tenant-scoped) → `router.refresh()`. `/members` + `GET /api/members` return inactive rows to everyone (no role filter). The `/members` header also shows the **active/inactive counts** (unfiltered) and an **Active** checkbox filter (`?active=1`) via optional `sub` / `activeToggle` props on `ListShell`. Flag flips never touch slips/exports/chat.

**Import history** — `GET /api/import/batches` returns each batch with a derived `kind` (`slips` | `palms`: linked to attendance/stats, else filename fallback); `components/ImportPage.tsx` renders **two tables**, one per kind, each with its own date/week filters and per-row Delete.

**Chat** — `getSlipsData(tenantId)` builds the snapshot + query index from tenant-scoped rows; cached per tenant (90s, `sharedState` key includes tenant id). Sessions are tenant- **and owner-scoped** (`owner_uid`): every list/read/write filters `owner_uid = uid` when the caller has a uid, so each user sees only their own chats.

**Chat suggestions** — the model ends each reply with a `SUGGESTIONS:` block of follow-up questions drawn from the turn just answered; `lib/chat/gemini.ts` strips it out of the answer text and returns it as `suggestions[]` → the generate route stores it as a hidden `[suggestions: …]` marker in `chat_messages.text` (same mechanism as `[tagged:]`/`[attached:]`) and returns it in the JSON. `ChatBox` splits the marker off on history load and renders the newest AI message's suggestions as the composer chips, falling back to the static starter list on a fresh chat.

**WhatsApp share** — pure client-side, no API route: `lib/whatsapp.ts` builds `https://wa.me/?text=<encoded>` from `whatsappShareUrl()` and formats the transcript with `buildChatShare()` → `{ text, total, included }` (greeting dropped, `You:`/`Slips AI:` per turn, `[file: …]` for attachments, and past the 20 000-char URL budget the oldest turns dropped so `included < total`). `ChatBox`'s toolbar button "Share chat" sends the whole transcript and, whenever `included < total`, states the `N of M` count in the toolbar; the per-message ⋮ menu's "Share to WhatsApp" sends that message only — both `window.open(url, "_blank")` in a user gesture, so WhatsApp opens prefilled and the app itself never transmits anything.

## Decisions (multi-tenant MVP)
- **Responsive via CSS + one drawer component**: one stylesheet (`app/globals.css`) with two media queries — `≤1024px` (tablet/iPad) and `≤640px` (phone) — instead of a viewport library or per-page layouts. Flexbox wrapping already covers toolbars/filters/export switches; tables scroll inside the existing `.table-scroll` (sticky `nowrap` headers make them overflow naturally); the only structural additions are a `.trend-svg-scroll` wrapper around the home chart SVG (and its skeleton twin) that pins the chart to its fixed 960px viewBox width on phones, and the **phone nav drawer**: `components/Nav.tsx` (client) keeps the 11 links in both the desktop pills and a slide-in drawer, with the hamburger toggle, overlay/Escape/route-change/resize closing and body-scroll lock all in that one component; CSS only switches visibility per breakpoint. Skeletons share the real CSS classes, so every responsive rule applies to loading states automatically.
- **Theme = one attribute + one palette block**: `<html data-theme>` — set before first paint by a tiny inline script in `app/layout.tsx` (stored `localStorage["bni-theme"]`, else the OS preference) — selects between the `:root` light palette (unchanged values; it now also names the surfaces that used to be hardcoded hexes: `--panel`, `--surface`, `--field`, `--chip`, `--*-ink`, …) and a `[data-theme="dark"]` block. No theme CSS is scoped per component; the only JS is `components/ThemeToggle.tsx` (icon button in the top bar + inside the phone drawer, kept in sync through a `bni-theme-change` event). Trend-chart colours are CSS vars consumed via inline `style`, so the lines and legend dots flip live without a re-render.
- **Tenant = chapter**, many-to-many memberships + switcher. **Open sign-in**: the Home Chapter is auto-granted on first sign-in (`lib/tenant-grant.ts`, open to every Google account, no admin UI); other chapters are provisioned by SQL insert per tenant.
- **No roles** (removed 2026-10-05, re-appliable later): every member of a tenant can import, browse, export, toggle members and chat — the only server-side gates are *authenticated* (`bni_session` cookie) and *member of this tenant*, both resolved by `getTenantContext()`. Migration 005 stays applied and `tenant_members.role` is unused, so re-adding roles later is pure code (no new DDL).
- **Per-user chats via `chat_sessions.owner_uid`**: ownership is checked in the API layer next to the tenant filter (list/create/rename/delete/messages/persist), not in RLS. Chats stay tenant-scoped too (owner scoping never replaces tenant scoping). Plain service-key callers (tests/scripts) have no uid → root view of the tenant's sessions; a service caller can pass `x-user-uid` to act as a specific member (also how the chat e2e test exercises owner scoping without a live Firebase session).
- **Auth via verified-ID-token cookie**, not middleware: `verifyFirebaseIdToken` (jose + Google JWKS) already exists and works without service-account keys; cookie is readable by server components and route handlers alike. Middleware was rejected — it cannot set cookies and JWKS verification per-request at the edge is heavier than needed here.
- **App-level scoping, not RLS**: every access already goes through server components/route handlers using the service-role client (bypasses RLS anyway), so `.eq("tenant_id", …)` on every query is the single enforcement point; membership is re-checked per request, so a forged `bni_tenant` cookie for a foreign tenant yields 403. RLS policies remain as-is (hardening later, not required for correctness here).
- **`bni_weeks` stays global** (shared ISO-Wednesday calendar, no tenant content); tenant week lists are derived from the tenant's own `import_batches`. `chapters` and `members` become tenant-scoped.
- **Home chapter is per tenant**: blank-Detail names file into `tenants.home_chapter_name` when set; otherwise `NEXT_PUBLIC_CHAPTER_NAME` applies **only to the default tenant (BNI Influencers)** and every other chapter falls back to its own name (auto-created on first import). Chapters named in a file's Detail column are created if missing and assigned to that other-chapter member (bold rule unchanged).
- **Backfill**: migration 004 creates one default tenant and assigns every existing row to it (single-tenant data preserved, no loss); memberships for existing users are added by the operator with one SQL insert per user (uid shown by the no-access screen).
- Denormalized `*_name` columns alongside fks stay, so grids render exactly like screenshots even when the member is other-chapter text.
- Pagination server-side with `range()`; queries keep their existing shape — tenant filter is one extra `.eq` per query (no query-builder rewrite).
