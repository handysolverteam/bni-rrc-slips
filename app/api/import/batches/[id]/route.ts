import { clearSlipsSnapshotCache } from "@/lib/chat/snapshot-cache";
import { clearDistinctCache } from "@/lib/distinct";
import { clearLatestImportedWeekCache } from "@/lib/report-view";
import { clearWeekOptionsCache } from "@/lib/server-weeks";
import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** The five tables an import writes; every row carries `import_batch_id`. */
const SLIP_TABLES = [
  "slip_referrals",
  "slip_one_to_ones",
  "slip_tyfcb",
  "slip_visitors",
  "slip_ceus",
] as const;

/**
 * Delete one import: the `import_batches` row plus every row that import
 * created — its rows across the 5 slip tables and, for a PALMS import, its
 * `member_attendance` rows and the `palms_stats` row it stored (FKs are
 * `on delete set null`, so the children are removed explicitly). Other
 * batches, weeks and imports are untouched.
 *
 * Tenant-scoped: an unknown or foreign id is a 404 (same convention as the
 * chat-session routes). Requires tenant only — every member may import, so
 * every member may delete an import.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const { id } = await params;
    const sb = getSupabaseServer();
    const { data: batch } = await sb
      .from("import_batches")
      .select("id")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (!batch) return Response.json({ error: "Import not found." }, { status: 404 });

    const removed: Record<string, number> = {};
    for (const table of SLIP_TABLES) {
      const { count, error } = await sb
        .from(table)
        .delete({ count: "exact" })
        .eq("import_batch_id", id)
        .eq("tenant_id", ctx.tenantId);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      removed[table] = count ?? 0;
    }
    // PALMS batch: its attendance rows + the comparison stats it stored.
    const { count: attendance, error: attError } = await sb
      .from("member_attendance")
      .delete({ count: "exact" })
      .eq("import_batch_id", id)
      .eq("tenant_id", ctx.tenantId);
    if (attError) return Response.json({ error: attError.message }, { status: 500 });
    removed.member_attendance = attendance ?? 0;
    const { count: stats, error: statsError } = await sb
      .from("palms_stats")
      .delete({ count: "exact" })
      .eq("import_batch_id", id)
      .eq("tenant_id", ctx.tenantId);
    if (statsError) return Response.json({ error: statsError.message }, { status: 500 });
    removed.palms_stats = stats ?? 0;

    const { error } = await sb
      .from("import_batches")
      .delete()
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    // Same cache set as a fresh import so every screen reflects the removal.
    clearWeekOptionsCache();
    clearDistinctCache();
    clearLatestImportedWeekCache();
    clearSlipsSnapshotCache();
    return Response.json({ ok: true, removed });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to delete the import." },
      { status: 500 },
    );
  }
}
