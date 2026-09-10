import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { repoRoot } from "@/lib/repo-root";

const REPO = repoRoot();
const FLOWS_INDEX = path.join(REPO, "data", "discovery-kb", "flows", "index.yaml");
const DESIGN = path.join(REPO, "apps", "automation", "test-design", "flows");

function extractSmeReady(raw: string): string[] {
  const block = raw.match(/sme_ready:\s*\n((?:\s+-\s+BF-[^\n]+\n?)+)/);
  if (!block) return [];
  return [...block[1].matchAll(/-\s+(BF-[A-Z0-9-]+)/g)].map((m) => m[1]);
}

export async function GET() {
  const flows: { flowId: string; status: string; scenarios: string; testCases: string; scripts: string }[] = [];
  try {
    const indexRaw = await fs.readFile(FLOWS_INDEX, "utf8");
    for (const flowId of [...new Set(extractSmeReady(indexRaw))]) {
      const designDir = path.join(DESIGN, flowId);
      let scenarios = "0";
      let testCases = "0";
      try {
        const sc = await fs.readFile(path.join(designDir, "scenarios.yaml"), "utf8");
        scenarios = String((sc.match(/^- id:/gm) || []).length || (sc.match(/scenarios:/g) ? 1 : 0));
        const tc = await fs.readFile(path.join(designDir, "test-cases.yaml"), "utf8");
        testCases = String((tc.match(/^- id: TC-/gm) || []).length);
      } catch {
        /* optional */
      }
      flows.push({ flowId, status: "PENDING_SME_REVIEW", scenarios, testCases, scripts: "1+" });
    }
  } catch {
    /* fallback */
  }
  return NextResponse.json({ status: "PENDING_SME_REVIEW", flows });
}
