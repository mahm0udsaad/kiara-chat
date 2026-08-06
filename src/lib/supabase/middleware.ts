import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Where signed-in users get bounced away from the auth screens.
const authEntryRoutes = ["/login", "/auth/callback"];

// Public/legal pages (needed by app-store reviewers and footer links).
const publicMarketingRoutes = ["/privacy", "/terms", "/support"];

const publicRoutes = [...authEntryRoutes, ...publicMarketingRoutes];

// Bypass the cookie-auth redirect: webhooks (OpenWA ingest) and mobile API
// authenticate themselves (signature / Bearer), and the middleware's
// cookie-only client can't validate those.
const publicPrefixes = [
  "/api/webhooks/",
  "/api/internal/",
  "/api/mobile/",
  "/api/session/",
  "/session/",
];

/**
 * Refreshes the Supabase session cookie and does coarse authenticated-or-not
 * gating. Per-tenant authorization happens in the (app) layout via
 * getKiaraSession(). Ported + trimmed (legacy member-auth removed — Kiara
 * Chat uses Supabase email/password only).
 *
 * Uses `getClaims()` rather than `getUser()`. `getUser()` is an unconditional
 * HTTPS round trip to /auth/v1/user (~250ms measured) on *every* request,
 * including API calls — it was the single largest fixed cost in the app.
 * `getClaims()` still refreshes an expired session (it goes through
 * `getSession()` first), then verifies the JWT locally against the project's
 * ES256 JWKS, so the network hop only happens when the token actually needs
 * refreshing. This is a coarse gate; anything that needs a server-verified
 * identity still calls getUser() via getKiaraSession().
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: claimsData } = await supabase.auth.getClaims();

  const isAuthenticated = Boolean(claimsData?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (isAuthenticated && authEntryRoutes.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    return NextResponse.redirect(url);
  }

  const isPublicPrefix = publicPrefixes.some((p) => pathname.startsWith(p));

  if (
    !isAuthenticated &&
    !publicRoutes.includes(pathname) &&
    pathname !== "/" &&
    !isPublicPrefix
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
