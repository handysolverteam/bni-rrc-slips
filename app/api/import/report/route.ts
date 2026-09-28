import { classifySlipType, mapInsideOutside, normalizeName, parseAmount, parseReportFile, type ParsedReport } from "@/lib/report-import";
import { parseReportXlsxBold } from "@/lib/report-bold";
import { buildWeekLabel, wednesdayOfWeek } from "@/lib/weeks";
import { clearWeekOptionsCache } from "@/lib/server-weeks";
import { clearSlipsSnapshotCache } from "@/lib/chat/snapshot-cache";
import { getSupabaseServer } from "@/lib/supabase/server";

/** Bulk import can exceed the default serverless timeout on file uploads. */
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
    if (!file.name.match(/\.(xls|xlsx|csv)$/i)) {
      return Response.json({ error: "Only .xls/.xlsx/.csv supported" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    // .xlsx goes through the bold-aware parser (bold name = other chapter);
    // anything it can't handle falls back to the plain parser.
    // .xls/.csv carry no formatting info: all names count as same-chapter.
    let parsed: ParsedReport;
    let boldUsed = false;
    if (/\.xlsx$/i.test(file.name)) {
      try {
        const boldParsed = await parseReportXlsxBold(buf);
        parsed = boldParsed;
        boldUsed = boldParsed.boldFound;
      } catch {
        parsed = parseReportFile(buf);
      }
    } else {
      parsed = parseReportFile(buf);
    }
    const { rows, errors: parseErrors, headers, columnMap, reportDate } = parsed;
    if (!reportDate) {
      return Response.json(
        { error: "Could not determine the meeting week from the file. Expected a title like 'Slips Audit Report for 01/04/2026' in its first rows." },
        { status: 400 },
      );
    }
    // The week always comes from the file itself (snapped to Wednesday) —
    // there is no week picker on the import screen.
    const meetingDate = wednesdayOfWeek(reportDate);
    const bniWeekLabel = buildWeekLabel(meetingDate);
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
      .insert({ filename: file.name, bni_week_id: week.id })
      .select()
      .single();

    let imported = 0;
    let skipped = 0;
    let tyfcbBlankAmount = 0;
    const errors: string[] = [...parseErrors];
    const batchId: string | null = batch?.id ?? null;
    const pushRowError = (msg: string) => {
      skipped++;
      if (errors.length < 50) errors.push(msg);
    };

    // ---- 1) Classify every row first (no I/O) and collect member names.
    // Bulk mode: the whole file costs ~10 HTTP calls instead of 2-3 per row.
    const neededNames = new Map<string, string>(); // lower name -> display name
    const keyOf = (raw: string, isOther: boolean): string | null => {
      const clean = normalizeName(raw);
      if (!clean || isOther) return null;
      const k = clean.toLowerCase();
      if (!neededNames.has(k)) neededNames.set(k, clean);
      return k;
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
        // Bold = other-chapter person: keep the name text, but don't
        // create a chapter-member record for them.
        const fromOther = r.fromBold === true;
        const toOther = r.toBold === true;
        referralRows.push({ fromName, toName, fromKey: keyOf(r.from, fromOther), toKey: keyOf(r.to, toOther), fromOther, toOther, other: detail, inside: insideOutside });
      } else if (kind === "one-to-one") {
        if (!fromName || !toName) { pushRowError(`Row ${r.rowNumber}: One-to-One needs From + To`); continue; }
        const initOther = r.fromBold === true;
        const metOther = r.toBold === true;
        otoRows.push({ initName: fromName, metName: toName, initKey: keyOf(r.from, initOther), metKey: keyOf(r.to, metOther), initOther, metOther, other: detail });
      } else if (kind === "tyfcb") {
        // To = thanked member (same chapter). From is normally blank: the
        // anonymous payment receiver doing the thanking; Detail (when filled)
        // names that thanker's (other) chapter.
        const name = toName || fromName;
        if (!name) { pushRowError(`Row ${r.rowNumber}: TYFCB needs To (member thanked)`); continue; }
        if (!r.tyfcb.trim()) tyfcbBlankAmount++;
        const thankerRaw = fromName;
        const thankerOther = thankerRaw ? r.fromBold === true : detail !== null;
        tyfcbRows.push({ name, nameKey: keyOf(toName || r.from, false), amount: parseAmount(r.tyfcb), other: detail, thankerRaw, thankerKey: keyOf(r.from, r.fromBold === true), thankerOther });
      } else if (kind === "visitor") {
        const fullName = toName || fromName;
        if (!fullName) { pushRowError(`Row ${r.rowNumber}: Visitor needs a name`); continue; }
        const inviterRaw = r.from && r.to ? fromName : null;
        visitorRows.push({ fullName, inviterRaw, inviterKey: r.from && r.to ? keyOf(r.from, false) : null });
      } else {
        const name = fromName || toName;
        if (!name) { pushRowError(`Row ${r.rowNumber}: CEU needs From member`); continue; }
        ceuRows.push({ name, nameKey: keyOf(r.from || r.to, false), credits: parseAmount(r.ceuCredits) });
      }
    }

    // ---- 2) Resolve member ids: one preload + one bulk insert for the missing.
    // (The old per-name upsert also never matched its conflict target, so new
    // members were silently never created — this fixes that too.)
    const memberIds = new Map<string, string>();
    if (neededNames.size > 0) {
      const { data: existingMembers } = await supabase.from("members").select("id,name").limit(5000);
      for (const m of ((existingMembers ?? []) as { id: string; name: string }[])) {
        memberIds.set(String(m.name).toLowerCase(), m.id);
      }
      const missing = [...neededNames.entries()].filter(([k]) => !memberIds.has(k));
      if (missing.length > 0) {
        const { data: created, error: createError } = await supabase
          .from("members")
          .insert(missing.map(([, name]) => ({ name })))
          .select("id,name");
        if (!createError && created) {
          for (const m of (created as { id: string; name: string }[])) {
            memberIds.set(String(m.name).toLowerCase(), m.id);
          }
        } else {
          // Concurrent-import race: resolve leftovers individually.
          for (const [k, name] of missing) {
            if (memberIds.has(k)) continue;
            const found = await supabase.from("members").select("id").ilike("name", name).limit(1).maybeSingle();
            let id: string | null = (found.data as { id: string } | null)?.id ?? null;
            if (!id) {
              const ins = await supabase.from("members").insert({ name }).select("id").maybeSingle();
              id = (ins.data as { id: string } | null)?.id ?? null;
            }
            if (id) memberIds.set(k, id);
          }
        }
      }
    }
    const midOf = (k: string | null): string | null => (k ? (memberIds.get(k) ?? null) : null);

    // ---- 3) Build payloads, skipping duplicates already stored for this week.
    // Keys mirror the dedupe unique indexes (lower() + nulls-as-empty).
    const dkey = (parts: (string | number | null | undefined)[]) =>
      JSON.stringify(parts.map((p) => (p ?? "").toString().toLowerCase()));

    async function existingKeys(
      table: string,
      cols: string,
      toKey: (e: Record<string, string | number | null>) => (string | number | null | undefined)[],
    ): Promise<Set<string>> {
      const { data, error } = await supabase.from(table).select(cols).eq("bni_week_id", weekId).limit(20000);
      if (error || !data) return new Set();
      const rows = data as unknown as Record<string, string | number | null>[];
      return new Set(rows.map((e) => dkey([weekId, ...toKey(e)])));
    }

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
          if (rowError && (rowError as { code?: string }).code === "23505") skipped++;
          else if (rowError) pushRowError(`${table}: ${rowError.message}`);
          else imported++;
        }
      }
    }

    async function insertFresh(
      table: string,
      payloads: Record<string, unknown>[],
      selectCols: string,
      toKey: (e: Record<string, string | number | null>) => (string | number | null | undefined)[],
    ) {
      if (payloads.length === 0) return;
      const seen = await existingKeys(table, selectCols, toKey);
      const fresh = payloads.filter((p) => {
        const k = dkey([weekId, ...toKey(p as Record<string, string | number | null>)]);
        if (seen.has(k)) {
          skipped++;
          return false;
        }
        seen.add(k);
        return true;
      });
      await bulkInsert(table, fresh);
    }

    await insertFresh(
      "slip_referrals",
      referralRows.map((r) => ({
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
      "from_name,to_name,other_chapter_member,inside_outside",
      (e) => [e.from_name, e.to_name, e.other_chapter_member, e.inside_outside],
    );

    await insertFresh(
      "slip_one_to_ones",
      otoRows.map((r) => ({
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
      "initiated_by_name,met_with_name,other_chapter_member",
      (e) => [e.initiated_by_name, e.met_with_name, e.other_chapter_member],
    );

    await insertFresh(
      "slip_tyfcb",
      tyfcbRows.map((r) => ({
        bni_week_id: weekId,
        member_id: midOf(r.nameKey),
        member_name: r.name,
        amount: r.amount,
        other_chapter_member: r.other,
        thanker_name: r.thankerRaw || null,
        thanker_is_other_chapter: r.thankerOther,
        import_batch_id: batchId,
      })),
      "member_name,amount,other_chapter_member",
      (e) => [e.member_name, Number(e.amount ?? 0), e.other_chapter_member],
    );

    await insertFresh(
      "slip_visitors",
      visitorRows.map((r) => ({
        bni_week_id: weekId,
        full_name: r.fullName,
        invited_by_member_id: midOf(r.inviterKey),
        invited_by_name: r.inviterRaw,
        import_batch_id: batchId,
      })),
      "full_name,invited_by_name",
      (e) => [e.full_name, e.invited_by_name],
    );

    // slip_ceus has no dedupe index: always insert.
    await bulkInsert(
      "slip_ceus",
      ceuRows.map((r) => ({
        bni_week_id: weekId,
        member_id: midOf(r.nameKey),
        member_name: r.name,
        credits: r.credits,
        import_batch_id: batchId,
      })),
    );

    await supabase
      .from("import_batches")
      .update({ imported_count: imported, skipped_count: skipped, error_message: errors.slice(0, 10).join(" | ") || null })
      .eq("id", batch?.id);

    // Fresh data: drop cached weeks + chat snapshot so screens update.
    clearWeekOptionsCache();
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
