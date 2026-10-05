# ARCHITECTURE — BNI Week Slips

```
bni-rrc-slips/
  docs/PRD.md SYSTEM.md ARCHITECTURE.md
  supabase/migrations/001_schema.sql     # full schema (single file)
                  002_member_chapters.sql
                  003_allow_duplicate_slips.sql
                  004_tenants.sql        # multi-tenant: tenants, tenant_members, tenant_id columns + backfill
                  005_rbac.sql           # RBAC: role check (admin|member) + chat_sessions.owner_uid (per-user chats)
  supabase/seed.sql                      # 74 members + Wednesdays Jan 2026-Dec 2027
  lib/
    supabase/server.ts   # getSupabaseServer (service_role on server, anon fallback)
    server-auth.ts       # getTenantContext() -> {uid, tenantId, role} | noAccess | null; adminOnly(ctx) gate; service callers may pass x-user-uid
    report-import.ts     # parseReportFile(buffer) -> rows; mapInsideOutside(); pure, tested
    report-view.ts       # fetchReportSections(tenantId, ...) — all report/export queries
    list-filters.ts lists.ts distinct.ts server-weeks.ts  # every query takes/uses tenantId
    member-chapters.ts   # resolveHomeChapter(tenant) — home_chapter_name ?? env (default tenant only) ?? tenant.name
    chat/snapshot.ts     # getSlipsData(tenantId) — per-tenant snapshot, cache key includes tenant_id
    firebase/admin.ts    # verifyFirebaseIdToken (jose JWKS) — used by the session cookie route
    types.ts
  app/
    layout.tsx + globals.css (AuthProvider + AppShell guard; AppShell posts ID token -> session cookie)
    api/auth/session/route.ts   # POST {idToken} set HttpOnly bni_session | DELETE clear
    api/tenant/route.ts         # GET current+list | POST {tenantId} switch (membership-checked)
    api/<resource>/route.ts     # every data API: getTenantContext() first (401 without session)
    api/members/[id]/route.ts   # PATCH {isInactive} — admin-only active/inactive toggle (tenant-scoped)
    members|referrals|one-to-ones|visitors|tyfcb|ceus|report|import|chat pages (server components
                                 call getTenantContext() -> redirect /login, noAccess -> no-access screen)
  components/TenantSwitcher.tsx # chapter switcher in the top nav (GET/POST /api/tenant)
  components/SlipsTable.tsx     # shared read-only table + pagination
  components/MemberActiveToggle.tsx # admin-only checkbox in the Active column (members list only)
```

## Data flow

**Session** — login (Google SSO) → AuthContext has a Firebase user → AppShell `POST /api/auth/session { idToken }` → server verifies via JWKS → HttpOnly cookie `bni_session` (re-posted on every app load, so a long-lived tab stays authenticated).

**Tenant** — every page render / API call → `getTenantContext()`:
1. verify `bni_session` cookie → `uid`
2. read `bni_tenant` cookie → membership lookup in `tenant_members` (falls back to first membership) → **role** (`admin`/`member`)
3. `{ uid, tenantId, role }` → all Supabase queries add `.eq("tenant_id", tenantId)`; writes also require `role === 'admin'` (import) and chat queries add `.eq("owner_uid", uid)`; `null` → 401 / redirect `/login`; signed-in but no memberships → no-access screen (uid + provisioning SQL).

**Switch** — TenantSwitcher → `POST /api/tenant { tenantId }` (403 if not a member) → cookie set → full reload → every server render re-scopes (lists, weeks, report, import batches, chat snapshot/sessions).

**Import** — upload → tenant-scoped batch/members/chapters/slips inserts → snapshot cache invalidated → report/chat immediately reflect the new rows for that tenant only.

**Active/inactive member** — `members.is_inactive` (default false = active; import never sets it). Admins get an `Active` checkbox column before Name → optimistic flip → `PATCH /api/members/{id}` (admin-only, tenant-scoped) → `router.refresh()`. `member` callers get neither the column nor inactive rows: `/members` + `GET /api/members` add `.eq("is_inactive", false)` when `role !== 'admin'`. Flag flips never touch slips/exports/chat.

**Chat** — `getSlipsData(tenantId)` builds the snapshot + query index from tenant-scoped rows; cached per tenant (90s, `sharedState` key includes tenant id). Sessions are tenant- **and owner-scoped** (`owner_uid`): every list/read/write filters `owner_uid = uid` when the caller has a uid, so each user sees only their own chats.

**Chat suggestions** — the model ends each reply with a `SUGGESTIONS:` block of follow-up questions drawn from the turn just answered; `lib/chat/gemini.ts` strips it out of the answer text and returns it as `suggestions[]` → the generate route stores it as a hidden `[suggestions: …]` marker in `chat_messages.text` (same mechanism as `[tagged:]`/`[attached:]`) and returns it in the JSON. `ChatBox` splits the marker off on history load and renders the newest AI message's suggestions as the composer chips, falling back to the static starter list on a fresh chat.

**WhatsApp share** — pure client-side, no API route: `lib/whatsapp.ts` builds `https://wa.me/?text=<encoded>` from `whatsappShareUrl()` and formats the transcript with `buildChatShare()` → `{ text, total, included }` (greeting dropped, `You:`/`Slips AI:` per turn, `[file: …]` for attachments, and past the 20 000-char URL budget the oldest turns dropped so `included < total`). `ChatBox`'s toolbar button "Share chat" sends the whole transcript and, whenever `included < total`, states the `N of M` count in the toolbar; the per-message ⋮ menu's "Share to WhatsApp" sends that message only — both `window.open(url, "_blank")` in a user gesture, so WhatsApp opens prefilled and the app itself never transmits anything.

## Decisions (multi-tenant MVP)
- **Tenant = chapter**, many-to-many memberships + switcher, provisioning via SQL only (per product decisions).
- **Role enforced at the app layer, not RLS** (same reasoning as tenant scoping below): `getTenantContext()` returns `role` from the membership row; `adminOnly(ctx)` 403s the import APIs for members, pages hide/redirect the import UI, and the client hides the Import nav via the role from `GET /api/tenant`. Admins themselves are created with a direct Supabase SQL insert (`role` default `'admin'`; `'member'` for read-only). Role changes are SQL, no role-management UI in this release.
- **Per-user chats via `chat_sessions.owner_uid`**: ownership is checked in the API layer next to the tenant filter (list/create/rename/delete/messages/persist), not in RLS. Chats stay tenant-scoped too (owner scoping never replaces tenant scoping). Plain service-key callers (tests/scripts) have no uid → root view of the tenant's sessions; a service caller can pass `x-user-uid` to act as a specific member (also how the rbac e2e test exercises member/admin paths without a live Firebase session).
- **Auth via verified-ID-token cookie**, not middleware: `verifyFirebaseIdToken` (jose + Google JWKS) already exists and works without service-account keys; cookie is readable by server components and route handlers alike. Middleware was rejected — it cannot set cookies and JWKS verification per-request at the edge is heavier than needed here.
- **App-level scoping, not RLS**: every access already goes through server components/route handlers using the service-role client (bypasses RLS anyway), so `.eq("tenant_id", …)` on every query is the single enforcement point; membership is re-checked per request, so a forged `bni_tenant` cookie for a foreign tenant yields 403. RLS policies remain as-is (hardening later, not required for correctness here).
- **`bni_weeks` stays global** (shared ISO-Wednesday calendar, no tenant content); tenant week lists are derived from the tenant's own `import_batches`. `chapters` and `members` become tenant-scoped.
- **Home chapter is per tenant**: blank-Detail names file into `tenants.home_chapter_name` when set; otherwise `NEXT_PUBLIC_CHAPTER_NAME` applies **only to the default tenant (BNI Influencers)** and every other chapter falls back to its own name (auto-created on first import). Chapters named in a file's Detail column are created if missing and assigned to that other-chapter member (bold rule unchanged).
- **Backfill**: migration 004 creates one default tenant and assigns every existing row to it (single-tenant data preserved, no loss); memberships for existing users are added by the operator with one SQL insert per user (uid shown by the no-access screen).
- Denormalized `*_name` columns alongside fks stay, so grids render exactly like screenshots even when the member is other-chapter text.
- Pagination server-side with `range()`; queries keep their existing shape — tenant filter is one extra `.eq` per query (no query-builder rewrite).
