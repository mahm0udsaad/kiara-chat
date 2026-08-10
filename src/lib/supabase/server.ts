import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

/**
 * Per-request Supabase client (RLS-respecting). Supports two transports:
 *  1. Cookie session — the web dashboard (browser → SSR).
 *  2. `Authorization: Bearer <jwt>` — the Expo mobile app (no cookies).
 *
 * Ported from the parent whatsapp-cs app so the mobile phase reuses the same
 * backend auth contract. The bearer branch wraps the auth verification
 * methods so call sites validate the header token transparently.
 *
 * Memoized per request: a single navigation used to build this three times
 * (middleware, layout, page), and each fresh client re-ran a network
 * `auth.getUser()` because nothing dedupes across instances.
 */
export const createServerSupabaseClient = cache(async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const headersList = await headers();
  const authHeader =
    headersList.get("authorization") ?? headersList.get("Authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) {
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      );

      const originalGetUser = client.auth.getUser.bind(client.auth);
      client.auth.getUser = ((jwt?: string) =>
        originalGetUser(jwt ?? token)) as typeof client.auth.getUser;

      const originalGetClaims = client.auth.getClaims.bind(client.auth);
      client.auth.getClaims = ((jwt?: string) =>
        originalGetClaims(jwt ?? token)) as typeof client.auth.getClaims;

      return client;
    }
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component — safe to ignore; middleware
            // refreshes the session cookie.
          }
        },
      },
    }
  );
});
