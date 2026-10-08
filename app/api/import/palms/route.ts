import { parsePalmsWideFile } from "@/lib/palms-import";
import { planPalmsImport } from "@/lib/palms-view";
import { clearLatestImportedWeekCache } from "@/lib/report-view";
import { clearWeekOptionsCache } from "@/lib/server-weeks";
import { fetchAllRows } from "@/lib/supabase/paged";
import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** Bulk insert can exceed the default serverless timeout on file uploads. */
export const maxDuration = 60;

/**
 * Imports BNI's wide `PALMS Attendance Report` (.xls/.xlsx): one file covering
 * ~6 months, one cell per member per Wednesday (`P A M S L` letters).
 *
 * Skip semantics: a cell whose (member, week) row already exists is never
 * replaced — only new rows insert (the unique index
 * `member_attendance_week_member_uq` enforces it at the DB too). One
 * `import_batches` row per uploaded file, `bni_week_id = NULL` (the file spans
 * many weeks); `imported_count` = inserted cells, `skipped_count` = cells that
 * already existed. Unknown header dates are skipped with a warning, never a
 * hard error. Slips are never touched — the two imports are independent.
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

    const parsed = parsePalmsWideFile(Buffer.from(await file.arrayBuffer()));
    if (parsed.errors.length > 0) {
      return Response.json({ error: parsed.errors[0], errors: parsed.errors }, { status: 400 });
    }
    const plan = await planPalmsImport(tenantId, parsed);
    const weekCount = new Set(plan.matchedColumns.map((c) => c.weekId)).size;
    const summary = {
      importedCount: 0,
      skippedCount: plan.cellSkipped,
      memberCount: plan.memberCount,
      weekCount,
      weeksUnknown: plan.weeksUnknown,
      issues: plan.issues,
      errors: [],
    };
    // Every cell already imported — nothing to create (the panel hides the
    // Import button in this state anyway).
    if (plan.rows.length === 0) return Response.json(summary);

    const supabase = getSupabaseServer();
    const { data: batch } = await supabase
      .from("import_batches")
      .insert({ filename: file.name, bni_week_id: null, tenant_id: tenantId })
      .select()
      .single();

    const rows = plan.rows.map((r) => ({
      ...r,
      tenant_id: tenantId,
      import_batch_id: batch?.id ?? null,
    }));
    let imported = 0;
    let raced = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("member_attendance").insert(chunk);
      if (!error) {
        imported += chunk.length;
        continue;
      }
      // One bad row must not sink the batch: retry row-by-row. A concurrent
      // import racing on the unique index counts as skipped, not failed.
      for (const row of chunk) {
        const { error: rowError } = await supabase.from("member_attendance").insert(row);
        if (rowError) {
          if (rowError.code === "23505") {
            raced++;
            continue;
          }
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

    const skipped = plan.cellSkipped + raced;
    if (batch?.id) {
      await supabase
        .from("import_batches")
        .update({
          imported_count: imported,
          skipped_count: skipped,
          error_message: JSON.stringify({ errors: plan.issues, skips: plan.skippedSamples }),
        })
        .eq("id", batch.id);
    }

    return Response.json({ ...summary, importedCount: imported, skippedCount: skipped });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * Remove ALL PALMS data for the tenant: every `member_attendance` row, the
 * legacy `palms_stats` rows, and the batches those rows reference (per-file
 * removal stays on `DELETE /api/import/batches/{id}`). Slips batches and slip
 * rows are never touched. Requires tenant only; 404 when there is nothing to
 * remove.
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const tenantId = ctx.tenantId;

    const [attendance, stats] = await Promise.all([
      fetchAllRows<{ import_batch_id: string | null }>("member_attendance", "import_batch_id", {
        eq: [["tenant_id", tenantId]],
        pageSize: 1000,
      }),
      fetchAllRows<{ import_batch_id: string | null }>("palms_stats", "import_batch_id", {
        eq: [["tenant_id", tenantId]],
        pageSize: 1000,
      }),
    ]);
    if (attendance.length === 0 && stats.length === 0) {
      return Response.json({ error: "No PALMS data imported for this chapter." }, { status: 404 });
    }
    const batchIds = new Set<string>();
    for (const r of [...attendance, ...stats]) if (r.import_batch_id) batchIds.add(r.import_batch_id);

    const sb = getSupabaseServer();
    const { count, error: delAttError } = await sb
      .from("member_attendance")
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId);
    if (delAttError) return Response.json({ error: delAttError.message }, { status: 500 });
    const { error: delStatsError } = await sb
      .from("palms_stats")
      .delete()
      .eq("tenant_id", tenantId);
    if (delStatsError) return Response.json({ error: delStatsError.message }, { status: 500 });
    for (const batchId of batchIds) {
      await sb.from("import_batches").delete().eq("id", batchId).eq("tenant_id", tenantId);
    }

    // Attendance is not in the chat snapshot or the slips-derived week list;
    // legacy PALMS batches may carry a week id, so those caches are dropped.
    clearWeekOptionsCache();
    clearLatestImportedWeekCache();
    return Response.json({ ok: true, removed: { attendance: count ?? 0, batches: batchIds.size } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
