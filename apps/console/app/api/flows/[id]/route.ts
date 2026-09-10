import { NextResponse } from "next/server";
import { getFlowSummary } from "@/lib/flow-artifacts";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const flow = await getFlowSummary(id);
  if (!flow) {
    return NextResponse.json({ error: "Flow not found or not SME-approved" }, { status: 404 });
  }
  return NextResponse.json({ flow });
}
