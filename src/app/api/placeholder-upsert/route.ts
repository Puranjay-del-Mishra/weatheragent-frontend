import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const ADMIN_SECRET = process.env.ADMIN_SECRET;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL) {
      return NextResponse.json(
        { error: "Missing SUPABASE_URL env var" },
        { status: 500 },
      );
    }

    if (!ADMIN_SECRET) {
      return NextResponse.json(
        { error: "Missing ADMIN_SECRET env var" },
        { status: 500 },
      );
    }

    if (!SERVICE_ROLE) {
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY env var" },
        { status: 500 },
      );
    }

    // Debug (safe)
    console.log("SUPABASE_URL?", !!SUPABASE_URL);
    console.log("ADMIN_SECRET len:", ADMIN_SECRET.length);
    console.log("SERVICE_ROLE len:", SERVICE_ROLE.length);

    const body = await req.json();

    const { email, timezone, preferred_time, units, cities, is_active } = body ?? {};

    if (
      !email ||
      !timezone ||
      !preferred_time ||
      !units ||
      !Array.isArray(cities)
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const upstream = await fetch(
      `${SUPABASE_URL}/functions/v1/upsert-subscriber`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",

          // 🔐 Supabase Edge Gateway auth (REQUIRED)
          "authorization": `Bearer ${SERVICE_ROLE}`,
          "apikey": SERVICE_ROLE,

          // 🔑 Your custom admin auth
          "x-admin-secret": ADMIN_SECRET.trim(),
        },
        body: JSON.stringify({
          email,
          timezone,
          preferred_time,
          units,
          cities,
          is_active,
        }),
      },
    );

    const text = await upstream.text();

    if (!upstream.ok) {
      return new NextResponse(text, { status: upstream.status });
    }

    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return new NextResponse(text, { status: 200 });
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 },
    );
  }
}
