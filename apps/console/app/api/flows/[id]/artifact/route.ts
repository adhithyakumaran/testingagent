import { NextResponse } from "next/server";
import { getArtifactMarkdown, type FlowArtifactType } from "@/lib/flow-artifacts";

const VALID: FlowArtifactType[] = ["scenarios", "test-cases", "suite", "scripts"];

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const type = new URL(req.url).searchParams.get("type") as FlowArtifactType | null;
  if (!type || !VALID.includes(type)) {
    return NextResponse.json({ error: "Invalid artifact type" }, { status: 400 });
  }

  const artifact = await getArtifactMarkdown(id, type);
  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  return NextResponse.json({ flowId: id, type, ...artifact });
}
