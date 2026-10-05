import { classifySlipType, isCountLikeName, mapInsideOutside, normalizeName, parseAmount } from "@/lib/report-import";
import { computeDesiredChapters, resolveHomeChapter } from "@/lib/member-chapters";
import { fetchAllRows } from "@/lib/supabase/paged";
import { parseUpload } from "@/lib/import-upload";
import { buildWeekLabel } from "@/lib/weeks";
import { clearWeekOptionsCache } from "@/lib/server-weeks";
import { clearDistinctCache } from "@/lib/distinct";
import { clearLatestImportedWeekCache } from "@/lib/report-view";
import { clearSlipsSnapshotCache } from "@/lib/chat/snapshot-cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { adminOnly, forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** Bulk import can exceed the default serverless timeout on file uploads. */
export const maxDuration = 60;

/** Admin-only write surface: a member gets 403 before the file is read. */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const denied = adminOnly(ctx);
    if (denied) return denied;
    const tenantId = ctx.tenantId;

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
    if (!file.name.match(/\.(xls|xlsx|csv)$/i)) {
      return Response.json({ error: "Only .xls/.xlsx/.csv supported" }, { status: 400 });
    }

    // The week always comes from the file itself (snapped to Wednesday) —
    // there is no week picker on the import screen.
    let upload;
    try {
      upload = await parseUpload(file);
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Could not read the file." },
        { status: 400 },
      );
    }
    const { rows, errors: parseErrors, headers, columnMap, meetingDate, weekLabel: bniWeekLabel, boldUsed } = upload;
    const supabase = getSupabaseServer();

    // Find-or-create week. New weeks take the next serial week_no and the
    // canonical "Week N D Month YYYY" label; legacy labels self-heal on import.
    let week: { id: string; label?: string | null; meeting_date?: string | null; week_no?: number | null } | null = null;
    if (meetingDate) {
      const { data } = await supabase
        .from("bni_weeks")
        .select()
        .eq("meeting_date", meetingDate)
        .maybeSingle();
      week = data;
    }
    if (!week) {
      const { data } = await supabase
        .from("bni_weeks")
        .select()
        .eq("label", bniWeekLabel)
        .maybeSingle();
      week = data;
    }
    if (!week) {
      const { data: maxRow } = await supabase
        .from("bni_weeks")
        .select("week_no")
        .order("week_no", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      const weekNo = (maxRow?.week_no ?? 0) + 1;
      const canonicalLabel = meetingDate ? buildWeekLabel(meetingDate) : bniWeekLabel;
      const { data: created, error: createError } = await supabase
        .from("bni_weeks")
        .insert({
          label: canonicalLabel,
          meeting_date: meetingDate || null,
          week_no: weekNo,
        })
        .select()
        .single();
      if (createError) {
        // Unique race (same date/label inserted concurrently) — fetch the winner.
        if (meetingDate) {
          const { data } = await supabase
            .from("bni_weeks")
            .select()
            .eq("meeting_date", meetingDate)
            .maybeSingle();
          week = data;
        }
        if (!week) {
          const { data } = await supabase
            .from("bni_weeks")
            .select()
            .eq("label", canonicalLabel)
            .maybeSingle();
          week = data;
        }
      } else {
        week = created;
      }
    } else if (meetingDate) {
      const canonicalLabel = buildWeekLabel(meetingDate);
      if (week.label !== canonicalLabel) {
        const { error } = await supabase
          .from("bni_weeks")
          .update({ label: canonicalLabel })
          .eq("id", week.id);
        if (!error) week = { ...week, label: canonicalLabel };
      }
    }
    if (!week) return Response.json({ error: "Could not create BNI week" }, { status: 500 });
    const weekId: string = week.id;

    const { data: batch } = await supabase
      .from("import_batches")
      .insert({ filename: file.name, bni_week_id: week.id, tenant_id: tenantId })
      .select()
      .single();

    let imported = 0;
    let skipped = 0;
    let tyfcbBlankAmount = 0;
    const errors: string[] = [...parseErrors];
    // One entry per skipped row (typing mistakes only — duplicate rows
    // are imported, never skipped) so the Import history table can show
    // exactly what was dropped and why.
    const skipDetails: string[] = [];
    const pushSkip = (msg: string) => {
      if (skipDetails.length < 1000) skipDetails.push(msg);
    };
    const SLIP_LABELS: Record<string, string> = {
      slip_referrals: "Referral",
      slip_one_to_ones: "One-to-One",
      slip_tyfcb: "TYFCB",
      slip_visitors: "Visitor",
      slip_ceus: "CEU",
    };
    const batchId: string | null = batch?.id ?? null;
    const pushRowError = (msg: string) => {
      skipped++;
      pushSkip(msg);
      if (errors.length < 50) errors.push(msg);
    };

    // ---- 1) Classify every row first (no I/O) and collect member names.
    // Bulk mode: the whole file costs ~10 HTTP calls instead of 2-3 per row.
    // Chapter rule (lib/member-chapters.ts, shared with preview): a BOLD
    // name belongs to its Detail chapter; every other name belongs to HOME.
    // Exception: TYFCB names never file members (chapter undecided for
    // now). The same name may belong to several chapters: each
    // (name, chapter) pair is its own member row — never moved or merged.
    // Visitor full names are never collected.
    // Home chapter (blank-Detail names): tenant's home_chapter_name first;
    // else env ONLY for the default tenant (BNI Influencers), else the
    // tenant's own name. Identical rule lives in lib/member-chapters.ts.
    // `id` must be selected too: resolveHomeChapter compares it with
    // DEFAULT_TENANT_ID to decide whether the env chapter may be used.
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("id, name, home_chapter_name")
      .eq("id", tenantId)
      .maybeSingle();
    const HOME_CHAPTER = resolveHomeChapter(
      (tenantRow as { id?: string; name?: string | null; home_chapter_name?: string | null } | null) ?? null,
    );
    // Pure pass: desired chapter per name, identical logic to preview.
    const desired = computeDesiredChapters(rows, HOME_CHAPTER);
    const keyOf = (raw: string): string | null => {
      const clean = normalizeName(raw);
      if (!clean || isCountLikeName(clean)) return null;
      return desired.has(clean.toLowerCase()) ? clean.toLowerCase() : null;
    };

    type ReferralRow = { fromName: string; toName: string; fromKey: string | null; toKey: string | null; fromOther: boolean; toOther: boolean; other: string | null; inside: string | null };
    type OtoRow = { initName: string; metName: string; initKey: string | null; metKey: string | null; initOther: boolean; metOther: boolean; other: string | null };
    type TyfcbRow = { name: string; nameKey: string | null; amount: number; other: string | null; thankerRaw: string; thankerKey: string | null; thankerOther: boolean };
    type VisitorRow = { fullName: string; inviterRaw: string | null; inviterKey: string | null };
    type CeuRow = { name: string; nameKey: string | null; credits: number };

    const referralRows: ReferralRow[] = [];
    const otoRows: OtoRow[] = [];
    const tyfcbRows: TyfcbRow[] = [];
    const visitorRows: VisitorRow[] = [];
    const ceuRows: CeuRow[] = [];

    for (const r of rows) {
      const kind = classifySlipType(r.slipType);
      if (!kind) {
        pushRowError(`Row ${r.rowNumber}: unknown Slip Type "${r.slipType}"`);
        continue;
      }
      const insideOutside = mapInsideOutside(r.insideOutside);
      const detail = r.detail.trim() || null;
      const fromName = normalizeName(r.from);
      const toName = normalizeName(r.to);

      if (kind === "referral") {
        if (!fromName || !toName) { pushRowError(`Row ${r.rowNumber}: Referral needs From + To`); continue; }
        if (isCountLikeName(fromName) || isCountLikeName(toName)) { pushRowError(`Row ${r.rowNumber}: Referral has a number instead of a name — skipped`); continue; }
        // Bold = other-chapter person: filed as a member of the Detail
        // chapter (never skipped).
        const fromOther = r.fromBold === true;
        const toOther = r.toBold === true;
        referralRows.push({ fromName, toName, fromKey: keyOf(r.from), toKey: keyOf(r.to), fromOther, toOther, other: detail, inside: insideOutside });
      } else if (kind === "one-to-one") {
        if (!fromName || !toName) { pushRowError(`Row ${r.rowNumber}: One-to-One needs From + To`); continue; }
        if (isCountLikeName(fromName) || isCountLikeName(toName)) { pushRowError(`Row ${r.rowNumber}: One-to-One has a number instead of a name — skipped`); continue; }
        const initOther = r.fromBold === true;
        const metOther = r.toBold === true;
        otoRows.push({ initName: fromName, metName: toName, initKey: keyOf(r.from), metKey: keyOf(r.to), initOther, metOther, other: detail });
      } else if (kind === "tyfcb") {
        // To = thanked member. TYFCB names never become members — the
        // thanked member's chapter is undecided, the thanker anonymous.
        const name = toName || fromName;
        if (!name) { pushRowError(`Row ${r.rowNumber}: TYFCB needs To (member thanked)`); continue; }
        if (isCountLikeName(name)) { pushRowError(`Row ${r.rowNumber}: TYFCB has a number instead of a name — skipped`); continue; }
        if (!r.tyfcb.trim()) tyfcbBlankAmount++;
        // TYFCB sections carry an extra leading Count column, so a purely
        // numeric From is the row number — never a thanker name.
        const thankerRaw = isCountLikeName(fromName) ? "" : fromName;
        const thankerOther = thankerRaw ? r.fromBold === true : detail !== null;
        tyfcbRows.push({ name, nameKey: keyOf(toName || r.from), amount: parseAmount(r.tyfcb), other: detail, thankerRaw, thankerKey: thankerRaw ? keyOf(r.from) : null, thankerOther });
      } else if (kind === "visitor") {
        const fullName = toName || fromName;
        if (!fullName) { pushRowError(`Row ${r.rowNumber}: Visitor needs a name`); continue; }
        if (isCountLikeName(fullName)) { pushRowError(`Row ${r.rowNumber}: Visitor has a number instead of a name — skipped`); continue; }
        // Visitor names never become members; only a non-bold inviter does.
        // A numeric inviter is the row number, not a person.
        const inviterRaw = r.from && r.to && !isCountLikeName(fromName) ? fromName : null;
        visitorRows.push({ fullName, inviterRaw, inviterKey: inviterRaw ? keyOf(r.from) : null });
      } else {
        const name = fromName || toName;
        if (!name) { pushRowError(`Row ${r.rowNumber}: CEU needs From member`); continue; }
        if (isCountLikeName(name)) { pushRowError(`Row ${r.rowNumber}: CEU has a number instead of a name — skipped`); continue; }
        ceuRows.push({ name, nameKey: keyOf(r.from || r.to), credits: parseAmount(r.ceuCredits) });
      }
    }

    // ---- 2) Resolve chapter + member ids: preloads + bulk inserts.
    // One member row per (name, chapter): reuse it when it exists,
    // create it otherwise. Same name in another chapter = separate row.
    const chapterIds = new Map<string, string>(); // lower chapter -> id
    const wantChapters = [...new Set([...desired.values()].map((v) => v.chapter))];
    if (wantChapters.length > 0) {
      // fetchAllRows, not .limit(2000): one response is capped at 1000 rows,
      // and a chapter past that cap would look "missing" and be re-created.
      const existingChapters = await fetchAllRows<{ id: string; name: string }>("chapters", "id,name", {
        eq: [["tenant_id", tenantId]],
        pageSize: 1000,
      });
      for (const c of existingChapters) {
        chapterIds.set(String(c.name).toLowerCase(), c.id);
      }
      const missingChapters = wantChapters.filter((n) => !chapterIds.has(n.toLowerCase()));
      if (missingChapters.length > 0) {
        const { data: created, error: createError } = await supabase
          .from("chapters")
          .insert(missingChapters.map((name) => ({ name, tenant_id: tenantId })))
          .select("id,name");
        if (!createError && created) {
          for (const c of (created as { id: string; name: string }[])) {
            chapterIds.set(String(c.name).toLowerCase(), c.id);
          }
        }
      }
      for (const name of missingChapters) {
        if (chapterIds.has(name.toLowerCase())) continue;
        const found = await supabase
          .from("chapters")
          .select("id")
          .ilike("name", name)
          .eq("tenant_id", tenantId)
          .limit(1)
          .maybeSingle();
        const id = (found.data as { id: string } | null)?.id ?? null;
        if (id) chapterIds.set(name.toLowerCase(), id);
      }
    }

    type ExistingMember = { id: string; name: string; chapter_id: string };
    const memberIds = new Map<string, string>(); // lower name -> member id
    if (desired.size > 0) {
      const existingMembers = await fetchAllRows<ExistingMember>( "members", "id,name,chapter_id", {
        eq: [["tenant_id", tenantId]],
        pageSize: 2000,
      });
      const byName = new Map<string, ExistingMember[]>();
      for (const m of existingMembers) {
        const k = String(m.name).toLowerCase();
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k)?.push(m);
      }
      const toCreate: { key: string; name: string; chapter_id: string }[] = [];
      for (const [k, w] of desired) {
        const cid = chapterIds.get(w.chapter.toLowerCase());
        if (!cid) continue;
        const rows = byName.get(k) ?? [];
        // Same name may belong to multiple chapters (owner rule): reuse
        // the row for the wanted chapter when there is one, otherwise add
        // a new (name, chapter) row. Existing rows are never moved or
        // merged — a person can be a member/visitor/referral party under
        // the same name in several chapters.
        const same = rows.find((r) => r.chapter_id === cid);
        if (same) {
          memberIds.set(k, same.id);
          continue;
        }
        toCreate.push({ key: k, name: w.name, chapter_id: cid });
      }
      if (toCreate.length > 0) {
        const { data: created, error: createError } = await supabase
          .from("members")
          .insert(toCreate.map(({ name, chapter_id }) => ({ name, chapter_id, tenant_id: tenantId })))
          .select("id,name");
        if (!createError && created) {
          for (const m of (created as { id: string; name: string }[])) {
            memberIds.set(String(m.name).toLowerCase(), m.id);
          }
        } else {
          // Concurrent-import race: resolve leftovers individually.
          for (const t of toCreate) {
            if (memberIds.has(t.key)) continue;
            const found = await supabase
              .from("members")
              .select("id")
              .ilike("name", t.name)
              .eq("chapter_id", t.chapter_id)
              .eq("tenant_id", tenantId)
              .limit(1)
              .maybeSingle();
            let id: string | null = (found.data as { id: string } | null)?.id ?? null;
            if (!id) {
              const ins = await supabase
                .from("members")
                .insert({ name: t.name, chapter_id: t.chapter_id, tenant_id: tenantId })
                .select("id")
                .maybeSingle();
              id = (ins.data as { id: string } | null)?.id ?? null;
            }
            if (id) memberIds.set(t.key, id);
          }
        }
      }
    }
    const midOf = (k: string | null): string | null => (k ? (memberIds.get(k) ?? null) : null);

    // ---- 3) Build payloads and insert EVERY row.
    // Owner rule: all file entries are correct — identical rows and
    // re-imports are kept as-is; only typing mistakes are skipped above.
    async function bulkInsert(table: string, payloads: Record<string, unknown>[]) {
      for (let i = 0; i < payloads.length; i += 1000) {
        const chunk = payloads.slice(i, i + 1000);
        const { error } = await supabase.from(table).insert(chunk);
        if (!error) {
          imported += chunk.length;
          continue;
        }
        // One bad row must not sink the batch: retry row-by-row.
        for (const row of chunk) {
          const { error: rowError } = await supabase.from(table).insert(row);
          if (rowError && (rowError as { code?: string }).code === "23505") {
            // Only possible while migration 003 (dedupe index drop) is pending.
            skipped++;
            pushSkip(`${SLIP_LABELS[table] ?? table}: duplicate rejected by a database rule — run supabase/migrations/003_allow_duplicate_slips.sql`);
          } else if (rowError) pushRowError(`${table}: ${rowError.message}`);
          else imported++;
        }
      }
    }

    await bulkInsert(
      "slip_referrals",
      referralRows.map((r) => ({
        tenant_id: tenantId,
        bni_week_id: weekId,
        from_member_id: midOf(r.fromKey),
        to_member_id: midOf(r.toKey),
        from_name: r.fromName,
        to_name: r.toName,
        other_chapter_member: r.other,
        inside_outside: r.inside,
        from_is_other_chapter: r.fromOther,
        to_is_other_chapter: r.toOther,
        import_batch_id: batchId,
      })),
    );

    await bulkInsert(
      "slip_one_to_ones",
      otoRows.map((r) => ({
        tenant_id: tenantId,
        bni_week_id: weekId,
        initiated_by_member_id: midOf(r.initKey),
        met_with_member_id: midOf(r.metKey),
        initiated_by_name: r.initName,
        met_with_name: r.metName,
        other_chapter_member: r.other,
        initiated_by_is_other_chapter: r.initOther,
        met_with_is_other_chapter: r.metOther,
        import_batch_id: batchId,
      })),
    );

    await bulkInsert(
      "slip_tyfcb",
      tyfcbRows.map((r) => ({
        tenant_id: tenantId,
        bni_week_id: weekId,
        member_id: midOf(r.nameKey),
        member_name: r.name,
        amount: r.amount,
        other_chapter_member: r.other,
        thanker_name: r.thankerRaw || null,
        thanker_is_other_chapter: r.thankerOther,
        import_batch_id: batchId,
      })),
    );

    await bulkInsert(
      "slip_visitors",
      visitorRows.map((r) => ({
        tenant_id: tenantId,
        bni_week_id: weekId,
        full_name: r.fullName,
        invited_by_member_id: midOf(r.inviterKey),
        invited_by_name: r.inviterRaw,
        import_batch_id: batchId,
      })),
    );

    await bulkInsert(
      "slip_ceus",
      ceuRows.map((r) => ({
        tenant_id: tenantId,
        bni_week_id: weekId,
        member_id: midOf(r.nameKey),
        member_name: r.name,
        credits: r.credits,
        import_batch_id: batchId,
      })),
    );

    const batchLog = JSON.stringify({ errors: errors.slice(0, 50), skips: skipDetails.slice(0, 1000) });
    const { error: batchError } = await supabase
      .from("import_batches")
      .update({
        imported_count: imported,
        skipped_count: skipped,
        error_message: errors.length || skipDetails.length ? batchLog : null,
      })
      .eq("id", batch?.id);
    if (batchError) {
      console.error("Import batch counts not saved", { batchId, error: batchError.message });
    }

    // Fresh data: drop cached weeks + filter options + default/latest week
    // + chat snapshot so screens update.
    clearWeekOptionsCache();
    clearDistinctCache();
    clearLatestImportedWeekCache();
    clearSlipsSnapshotCache();

    return Response.json({
      importedCount: imported,
      skippedCount: skipped,
      tyfcbBlankAmount,
      boldUsed,
      errors,
      bniWeek: bniWeekLabel,
      columns: headers.filter(Boolean),
      columnMap,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
