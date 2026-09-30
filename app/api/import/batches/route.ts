import { getSupabaseServer } from "@/lib/supabase/server";

/** Import history: every uploaded file with its week and row counts. */
export async function GET() {
  try {
    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("import_batches")
      .select("id,filename,imported_count,skipped_count,status,error_message,created_at,bni_weeks(label,meeting_date)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ batches: data ?? [] });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load import history." },
      { status: 500 },
    );
  }
}
