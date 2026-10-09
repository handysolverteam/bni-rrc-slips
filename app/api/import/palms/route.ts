import { clearSlipsSnapshotCache } from "@/lib/chat/snapshot-cache";
import { resolveImportTarget } from "@/lib/chapter-target";
import { aliasPalmsMembers, nameKey, parseMergePicks } from "@/lib/alias-map";
import { clearDistinctCache } from "@/lib/distinct";
import { loadAliasMap, saveAliases } from "@/lib/member-aliases";
import { createHomeMembers, findNewHomeNames, homeChapterNameOf, memberKey, parseSkipMembers } from "@/lib/new-members";
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
 * New members: names not yet in the Home Chapter are ADDED to it (the `skipMembers`
 * form field lists the ones the user un-ticked — they are not added and their
 * attendance is not stored). The optional `chapter` field picks another existing
 * chapter or creates a new one (see lib/chapter-target.ts).
 * Requires tenant only — same write surface as the slips import.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    let tenantId = ctx.tenantId;

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
    const target = await resolveImportTarget({ uid: ctx.uid, tenantId: ctx.tenantId }, form.get("chapter"));
    if ("error" in target) return Response.json({ error: target.error }, { status: target.status });
    tenantId = target.tenantId;

    // Add the new home-chapter members the user left ticked; un-ticked ones are
    // skipped together with their attendance.
    const homeName = await homeChapterNameOf(tenantId);
    // Merges picked in the preview are remembered, then every remembered merge is applied.
    const picks = parseMergePicks(form.get("mergeMembers"));
    const savedAliases = await saveAliases(tenantId, picks);
    const aliasMap = await loadAliasMap(tenantId);
    for (const [a, c] of Object.entries(picks)) if (!aliasMap.has(nameKey(a))) aliasMap.set(nameKey(a), c);
    const mapped = { ...parsed, members: aliasPalmsMembers(parsed.members, aliasMap) };
    const newNames = await findNewHomeNames(tenantId, homeName, mapped.members.map((m) => m.name));
    const skip = parseSkipMembers(form.get("skipMembers"));
    const skipKeys = new Set(newNames.map(memberKey).filter((k) => skip.has(k)));
    const membersAdded = await createHomeMembers(
      tenantId,
      homeName,
      newNames.filter((n) => !skipKeys.has(memberKey(n))),
    );
    const plan = await planPalmsImport(tenantId, mapped, skipKeys);
    const weekCount = new Set(plan.matchedColumns.map((c) => c.weekId)).size;
    const summary = {
      importedCount: 0,
      skippedCount: plan.cellSkipped,
      memberCount: plan.memberCount,
      weekCount,
      weeksUnknown: plan.weeksUnknown,
      issues: plan.issues,
      errors: [],
      tenantId,
      membersAdded,
      membersSkipped: skipKeys.size,
      aliasesSaved: savedAliases.saved,
      ...(savedAliases.error ? { warning: `Merges applied for this import but not remembered (${savedAliases.error}). Run supabase/migrations/008_member_aliases.sql.` } : {}),
    };
    // Every cell already imported — nothing to create (the panel hides the
    // Import button in this state anyway).
    // New members change the member lists; new attendance changes the chat data.
    clearDistinctCache();
    clearSlipsSnapshotCache();
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

    clearSlipsSnapshotCache();
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
