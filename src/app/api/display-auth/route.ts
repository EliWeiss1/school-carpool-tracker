import { NextResponse } from "next/server";

import {
  accessToken,
  configuredDisplayPassword,
  DISPLAY_COOKIE,
  DISPLAY_COOKIE_MAX_AGE_SECONDS,
  passwordIsCorrect,
} from "@/lib/display-auth";

/** Checks the /display password and, if right, sets the access cookie. */
export async function POST(request: Request) {
  const password = configuredDisplayPassword();
  if (password === null) {
    return NextResponse.json(
      {
        error:
          "The display password is not set up on the server. Ask whoever installed the app.",
      },
      { status: 503 },
    );
  }

  let attempt = "";
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "password" in body) {
      const value = (body as { password: unknown }).password;
      if (typeof value === "string") attempt = value.trim();
    }
  } catch {
    // Falls through to the wrong-password answer below.
  }

  if (attempt === "" || !(await passwordIsCorrect(attempt, password))) {
    return NextResponse.json(
      { error: "That password was not recognised. Check with the office." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DISPLAY_COOKIE, await accessToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DISPLAY_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
