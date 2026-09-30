import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// One client per process: env is static, and re-creating per request wastes
// connection setup on every call.
let client: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    // Service role preferred for imports; anon fallback for reads.
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
