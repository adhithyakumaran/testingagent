import { NextResponse } from "next/server";
import { requireRunAccess } from "@/lib/api-auth";
import { hydrateRunFromWarmAgent } from "@/lib/run-hydration";
import { mutateState, readState } from "@/lib/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await requireRunAccess(req, id);
  if (denied) return denied;
  const state = await readState();
  let run = state.runs.find((r) => r.id === id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const hydrated = await hydrateRunFromWarmAgent(run);
  if (hydrated !== run) {
    await mutateState((s) => {
      const idx = s.runs.findIndex((r) => r.id === id);
      if (idx >= 0) s.runs[idx] = hydrated;
    });
    run = hydrated;
  }
  return NextResponse.json({ run });
}
