import { parsePalmsFile } from "@/lib/palms-import";
import { fetchPalmsComparisons } from "@/lib/palms-compare";
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
 * The tenant must have imported that meeting's slips first (the comparison
 * needs them, and the week must not be attendance-only).
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
          error: `No BNI week for ${meetingDate} — import the Slips Audit Report for that meeting first.`,
        },
        { status: 400 },
      );
    }
    // The calendar is pre-seeded, so the week can exist without this tenant's
    // slips — attendance-only weeks are refused (the comparison needs slips).
    const { data: weekBatch } = await supabase
      .from("import_batches")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("bni_week_id", week.id)
      .limit(1);
    if (!weekBatch || weekBatch.length === 0) {
      return Response.json(
        {
          error: `No slips imported for ${week.label} — import the Slips Audit Report for that meeting first.`,
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
    const comparison = (await fetchPalmsComparisons(tenantId, [week.id]))[0] ?? null;

    return Response.json({
      importedCount: imported,
      replacedCount: existing?.length ?? 0,
      meetingDate,
      weekLabel: week.label,
      comparison,
      errors: [],
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
