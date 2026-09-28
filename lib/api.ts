import { getSupabaseServer } from "@/lib/supabase/server";

export function paging(url: string, page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function supabase() {
  return getSupabaseServer();
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
