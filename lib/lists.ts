import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized, type TenantContext } from "@/lib/server-auth";

function paging(req: Request) {
  const u = new URL(req.url);
  return {
    pageNum: Math.max(1, Number(u.searchParams.get("page") || 1)),
    pageSize: Math.min(150, Math.max(1, Number(u.searchParams.get("pageSize") || 100))),
    week: u.searchParams.get("week") || "",
    q: u.searchParams.get("q") || "",
  };
}

/** Narrowed context: null / noAccess are already rejected by the caller. */
type ActiveCtx = Extract<TenantContext, { tenantId: string }>;

function buildBase(table: string, ctx: ActiveCtx) {
  return getSupabaseServer()
    .from(table)
    .select("*", { count: "exact" })
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });
}

async function list(table: string, req: Request, orFilter?: (q: string) => string) {
  const ctx = await getTenantContext(req);
  if (!ctx) return unauthorized();
  if ("noAccess" in ctx) return forbidden();

  const { pageNum, pageSize, q } = paging(req);
  const active = ctx as ActiveCtx;
  let query = buildBase(table, active);
  if (q && orFilter) query = query.or(orFilter(q));
  const from = (pageNum - 1) * pageSize;
  const { data, count, error } = await query.range(from, from + pageSize - 1);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rows: data, total: count ?? 0, page: pageNum, pageSize });
}

export async function membersGET(req: Request) {
  // Active and inactive members are listed for everyone (roles were removed).
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
