import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServerFetch } from "@/lib/supabase/fetch";

/**
 * Service-role client — BYPASSES RLS. Reserved for narrow admin tasks
 * (creating/suspending agent accounts, server-side jobs). Prefer the
 * RLS-respecting server client for tenant data reads.
 *
 * Lazily constructed so read-only phases can boot without the service key.
 * Throws only when actually used without SUPABASE_SERVICE_ROLE_KEY set.
 */
let cached: SupabaseClient | null = null;

export function getAdminSupabaseClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  cached = createClient(url, key, {
    global: { fetch: supabaseServerFetch },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
