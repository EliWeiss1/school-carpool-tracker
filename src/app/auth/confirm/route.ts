import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeNext } from "@/lib/safe-redirect";
import { getServerClient } from "@/lib/supabase/server";

/**
 * Where the links in Supabase's emails land (sign-up confirmation and password
 * reset). Two link styles exist and both are handled: `token_hash` + `type`
 * (verified here with `verifyOtp`) and the PKCE `code` (exchanged for a
 * session). Either way the session cookie is set on this response, then the
 * person goes on to `next`, which `safeNext` limits to a path on this site.
 */
const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function isOtpType(value: string | null): value is EmailOtpType {
  return OTP_TYPES.includes(value as EmailOtpType);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNext(searchParams.get("next"));
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  try {
    const supabase = getServerClient();
    let failed = true;

    if (tokenHash && isOtpType(type)) {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      failed = Boolean(error);
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      failed = Boolean(error);
    }

    if (!failed) return NextResponse.redirect(new URL(next, origin));
  } catch {
    // Misconfigured or unreachable Auth: treated like a bad link below.
  }

  return NextResponse.redirect(new URL("/login?error=link", origin));
}
