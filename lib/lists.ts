import { getSupabaseServer } from "@/lib/supabase/server";

function paging(req: Request) {
  const u = new URL(req.url);
  return {
    pageNum: Math.max(1, Number(u.searchParams.get("page") || 1)),
    pageSize: Math.min(150, Math.max(1, Number(u.searchParams.get("pageSize") || 100))),
    week: u.searchParams.get("week") || "",
    q: u.searchParams.get("q") || "",
  };
}

async function list(table: string, req: Request, orFilter?: (q: string) => string) {
  const { pageNum, pageSize, q } = paging(req);
  const sb = getSupabaseServer();
  let query = sb.from(table).select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (q && orFilter) query = query.or(orFilter(q));
  const from = (pageNum - 1) * pageSize;
  const { data, count, error } = await query.range(from, from + pageSize - 1);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rows: data, total: count ?? 0, page: pageNum, pageSize });
}

export async function membersGET(req: Request) {
  return list("members", req, (q) => `name.ilike.%${q}%`);
}
export async function referralsGET(req: Request) {
  return list("slip_referrals", req, (q) => `from_name.ilike.%${q}%,to_name.ilike.%${q}%`);
}
export async function oneToOnesGET(req: Request) {
  return list("slip_one_to_ones", req, (q) => `initiated_by_name.ilike.%${q}%,met_with_name.ilike.%${q}%`);
}
export async function visitorsGET(req: Request) {
  return list("slip_visitors", req, (q) => `full_name.ilike.%${q}%,invited_by_name.ilike.%${q}%`);
}
export async function tyfcbGET(req: Request) {
  return list("slip_tyfcb", req, (q) => `member_name.ilike.%${q}%`);
}
export async function ceusGET(req: Request) {
  return list("slip_ceus", req, (q) => `member_name.ilike.%${q}%`);
}
