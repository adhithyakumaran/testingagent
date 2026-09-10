import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { repoRoot } from "@/lib/repo-root";

export async function GET(req: Request) {
  const tag = new URL(req.url).searchParams.get("tag");
  const indexPath = path.join(repoRoot(), "data", "discovery-kb", "flows", "index.yaml");
  const flowsDir = path.join(repoRoot(), "data", "discovery-kb", "flows");

  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const smeBlock = raw.match(/sme_ready:\s*\n((?:\s+-\s+BF-[^\n]+\n?)+)/);
    const ready = smeBlock
      ? [...smeBlock[1].matchAll(/-\s+(BF-[A-Z0-9-]+)/g)].map((m) => m[1])
      : [];

    const flows: { id: string; name: string; status: string; tags: string[] }[] = [];
    for (const id of [...new Set(ready)]) {
      const metaPath = path.join(flowsDir, `${id}.yaml`);
      let name = id;
      let status = "READY";
      try {
        const doc = await fs.readFile(metaPath, "utf8");
        const nm = doc.match(/^flow_name:\s*(.+)$/m);
        if (nm) name = nm[1].trim();
        const st = doc.match(/^status:\s*(.+)$/m);
        if (st) status = st[1].trim();
      } catch {
        /* optional meta */
      }
      flows.push({ id, name, status, tags: tag ? [tag] : ["@sanity", "@regression"] });
    }

    const filtered = tag
      ? flows.filter((f) => f.tags.some((t) => t.includes(tag) || tag === "sanity"))
      : flows;

    return NextResponse.json({
      flows: filtered.length ? filtered : flows,
      count: (filtered.length ? filtered : flows).length,
      tag: tag || "all",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), flows: [] }, { status: 500 });
  }
}
