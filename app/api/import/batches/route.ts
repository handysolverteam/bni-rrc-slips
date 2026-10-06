import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";
import { fetchAllRows } from "@/lib/supabase/paged";

/**
 * Batch ids still referenced by PALMS rows. Chunked: a long `in.(...)` URL
 * blows past the header-buffer limit around 200 ids.
 */
async function referencedPalmsIds(tenantId: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    for (const table of ["member_attendance", "palms_stats"]) {
      const rows = await fetchAllRows<{ import_batch_id: string | null }>(table, "import_batch_id", {
        eq: [["tenant_id", tenantId]],
        in: [["import_batch_id", chunk]],
      });
      for (const r of rows) if (r.import_batch_id) found.add(r.import_batch_id);
    }
  }
  return found;
}

/**
 * Import history: every uploaded file with its week and row counts (tenant-scoped).
 * `kind` is derived, not stored: a batch referenced by PALMS attendance/stats
 * rows is `palms`; unreferenced batches fall back to the filename (a re-import
 * replaces the week's rows, orphaning the older PALMS batch).
 */
export async function GET(req: Request) {
  try {
    const ctx = await getTenantContext(req);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("import_batches")
      .select("id,filename,imported_count,skipped_count,status,error_message,created_at,bni_weeks(label,meeting_date)")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];
    const palmsIds = rows.length ? await referencedPalmsIds(ctx.tenantId, rows.map((b) => b.id)) : new Set<string>();
    const isPalmsFile = /palms|chapter[_ -]?summary/i;
    const batches = rows.map((b) => ({
      ...b,
      kind: palmsIds.has(b.id) || isPalmsFile.test(b.filename) ? ("palms" as const) : ("slips" as const),
    }));
    return Response.json({ batches });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load import history." },
      { status: 500 },
    );
  }
}
