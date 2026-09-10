import { NextResponse } from "next/server";
import { listApprovedFlows } from "@/lib/flow-artifacts";

export async function GET(req: Request) {
  const tag = new URL(req.url).searchParams.get("tag");

  try {
    let flows = await listApprovedFlows();

    if (tag === "sanity") {
      flows = flows.filter((f) => f.tags.includes("@sanity"));
    }

    return NextResponse.json({
      flows,
      count: flows.length,
      tag: tag || "all",
      source: "sme_ready",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), flows: [], count: 0 }, { status: 500 });
  }
}
