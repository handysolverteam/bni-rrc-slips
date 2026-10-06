import { parsePalmsFile } from "@/lib/palms-import";
import { fetchPalmsComparisons } from "@/lib/palms-compare";
import { clearLatestImportedWeekCache } from "@/lib/report-view";
import { clearWeekOptionsCache } from "@/lib/server-weeks";
import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** Bulk insert can exceed the default serverless timeout on file uploads. */
export const maxDuration = 60;

/**
 * Imports BNI's `Chapter Summary PALMS Report` (.xls/.xlsx): the per-member
 * attendance columns P A L M S + T for ONE meeting date (From = To), plus the
 * file's `Total` row (slip counts) stored in `palms_stats` for the
 * PALMS-vs-slips comparison.
 *
 * Replace semantics: the active tenant's `member_attendance` rows for that
 * week are replaced by the file's rows, so a re-import is always idempotent.
 * Slips are NOT required first — the two imports are independent; when the
 * week's slips are missing the response carries a `warning` notice instead
 * (and `comparison` is null: there is nothing to compare yet).
 * Requires tenant only — same write surface as the slips import.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const tenantId = ctx.tenantId;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
    if (!file.name.match(/\.(xls|xlsx)$/i)) {
      return Response.json({ error: "Only .xls/.xlsx supported" }, { status: 400 });
    }

    const parsed = parsePalmsFile(Buffer.from(await file.arrayBuffer()));
    if (parsed.errors.length > 0) {
      return Response.json(
        { error: parsed.errors[0], errors: parsed.errors },
        { status: 400 },
      );
    }
    const meetingDate = parsed.meetingDate as string;

    const supabase = getSupabaseServer();
    const { data: week } = await supabase
      .from("bni_weeks")
      .select("id, label")
      .eq("meeting_date", meetingDate)
      .maybeSingle();
    if (!week) {
      return Response.json(
        {
          error: `No BNI meeting week for ${meetingDate} — that date is not on the chapter's Wednesday calendar.`,
        },
        { status: 400 },
      );
    }

    // Missing table = migration 006/007 not run yet — stop before deleting anything.
    const { data: existing, error: selectError } = await supabase
      .from("member_attendance")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("bni_week_id", week.id);
    if (selectError) {
      return Response.json(
        { error: `Could not read member_attendance (${selectError.message}) — run supabase/migrations/006_attendance.sql first.` },
        { status: 500 },
      );
    }

    const { data: batch } = await supabase
      .from("import_batches")
      .insert({ filename: file.name, bni_week_id: week.id, tenant_id: tenantId })
      .select()
      .single();

    if (existing && existing.length > 0) {
      const { error: deleteError } = await supabase
        .from("member_attendance")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("bni_week_id", week.id);
      if (deleteError) {
        return Response.json({ error: `Could not replace existing attendance: ${deleteError.message}` }, { status: 500 });
      }
    }

    const rows = parsed.members.map((m) => ({
      tenant_id: tenantId,
      bni_week_id: week.id,
      member_name: m.name,
      present: m.present,
      absent: m.absent,
      l: m.l,
      m: m.m,
      s: m.s,
      t: m.t,
      import_batch_id: batch?.id ?? null,
    }));
    let imported = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("member_attendance").insert(chunk);
      if (!error) {
        imported += chunk.length;
        continue;
      }
      // One bad row must not sink the batch: retry row-by-row.
      for (const row of chunk) {
        const { error: rowError } = await supabase.from("member_attendance").insert(row);
        if (rowError) {
          if (batch?.id) {
            await supabase
              .from("import_batches")
              .update({ status: "failed", error_message: JSON.stringify({ errors: [rowError.message] }) })
              .eq("id", batch.id);
          }
          return Response.json({ error: rowError.message }, { status: 500 });
        }
        imported++;
      }
    }

    if (batch?.id) {
      await supabase
        .from("import_batches")
        .update({ imported_count: imported, skipped_count: 0 })
        .eq("id", batch.id);
    }

    // Store the file's Total row for the PALMS-vs-slips comparison.
    const t = parsed.palmsTotals;
    const { error: statsError } = await supabase.from("palms_stats").upsert(
      {
        tenant_id: tenantId,
        bni_week_id: week.id,
        rgi: t?.rgi ?? 0,
        rgo: t?.rgo ?? 0,
        rri: t?.rri ?? 0,
        rro: t?.rro ?? 0,
        visitors: t?.visitors ?? 0,
        one_to_ones: t?.oneToOnes ?? 0,
        tyfcb: t?.tyfcb ?? 0,
        ceu: t?.ceu ?? 0,
        import_batch_id: batch?.id ?? null,
      },
      { onConflict: "tenant_id,bni_week_id" },
    );
    if (statsError) {
      return Response.json(
        { error: `Could not store the comparison stats (${statsError.message}) — run supabase/migrations/007_palms_stats.sql first.` },
        { status: 500 },
      );
    }

    // Immediate verdict: PALMS's own numbers vs this week's imported slips.
    // fetchPalmsComparisons skips weeks without imported slips, so a null
    // comparison here means "slips not imported yet" — surfaced as a notice.
    const comparison = (await fetchPalmsComparisons(tenantId, [week.id]))[0] ?? null;
    const warning = comparison
      ? undefined
      : `No slips imported for ${week.label} — import the Slips Audit Report for that meeting first.`;

    return Response.json({
      importedCount: imported,
      replacedCount: existing?.length ?? 0,
      meetingDate,
      weekLabel: week.label,
      comparison,
      ...(warning ? { warning } : {}),
      errors: [],
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * Remove a week's PALMS import: all `member_attendance` for (tenant, week),
 * its `palms_stats` row, and the `import_batches` rows those rows reference
 * (superseded PALMS history entries are not referenced and stay, deletable
 * individually via `DELETE /api/import/batches/{id}`). The slips import is
 * never touched. Requires tenant only; 404 when the week has no PALMS data.
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const tenantId = ctx.tenantId;
    const weekId = new URL(request.url).searchParams.get("week") ?? "";
    if (!weekId) return Response.json({ error: "week is required" }, { status: 400 });

    const sb = getSupabaseServer();
    const [attendance, stats] = await Promise.all([
      sb
        .from("member_attendance")
        .select("import_batch_id")
        .eq("tenant_id", tenantId)
        .eq("bni_week_id", weekId)
        .limit(500),
      sb
        .from("palms_stats")
        .select("import_batch_id")
        .eq("tenant_id", tenantId)
        .eq("bni_week_id", weekId)
        .maybeSingle(),
    ]);
    if (attendance.error) return Response.json({ error: attendance.error.message }, { status: 500 });
    const rows = attendance.data ?? [];
    const stat = stats.data;
    if (rows.length === 0 && !stat) {
      return Response.json({ error: "No PALMS summary imported for that week." }, { status: 404 });
    }
    const batchIds = new Set<string>();
    for (const r of rows) if (r.import_batch_id) batchIds.add(r.import_batch_id);
    if (stat?.import_batch_id) batchIds.add(stat.import_batch_id);

    const { count, error: delAttError } = await sb
      .from("member_attendance")
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("bni_week_id", weekId);
    if (delAttError) return Response.json({ error: delAttError.message }, { status: 500 });
    const { error: delStatsError } = await sb
      .from("palms_stats")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("bni_week_id", weekId);
    if (delStatsError) return Response.json({ error: delStatsError.message }, { status: 500 });
    for (const batchId of batchIds) {
      await sb.from("import_batches").delete().eq("id", batchId).eq("tenant_id", tenantId);
    }

    // Attendance is not in the chat snapshot/distinct options — only the
    // week list and the latest-imported-week pointer can move (batch gone).
    clearWeekOptionsCache();
    clearLatestImportedWeekCache();
    return Response.json({ ok: true, removed: { attendance: count ?? 0, batches: batchIds.size } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
