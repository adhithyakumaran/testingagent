import { NextResponse } from "next/server";

const LOCAL_AGENT_URL = process.env.LOCAL_AGENT_URL || "http://127.0.0.1:43124";

export async function GET() {
  try {
    const res = await fetch(`${LOCAL_AGENT_URL}/health`, { cache: "no-store" });
    const json = await res.json();
    return NextResponse.json(json, { status: res.ok ? 200 : 503 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 503 });
  }
}
