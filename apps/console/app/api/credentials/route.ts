import { NextResponse } from "next/server";
import { applyAutomationEnvToProcess, getUatCredentials, saveUatCredentials } from "@/lib/uat-env";

export async function GET() {
  try {
    const creds = await getUatCredentials();
    return NextResponse.json({ credentials: creds });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const credentials = await saveUatCredentials(body);
    await applyAutomationEnvToProcess();
    return NextResponse.json({ credentials, saved: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
