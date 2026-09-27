import { NextResponse } from "next/server";
import { requireRunAccess } from "@/lib/api-auth";
import { loadRunForClient } from "@/lib/run-get";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await requireRunAccess(req, id);
  if (denied) return denied;
  try {
    const run = await loadRunForClient(id);
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (err) {
    console.error("[api/runs/id] GET failed", id, err);
    return NextResponse.json(
      { error: "run_load_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
