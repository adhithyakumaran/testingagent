import { promises as fs } from "fs";
import path from "path";
import { repoRoot } from "@/lib/repo-root";

export type FlowArtifactType = "scenarios" | "test-cases" | "suite" | "scripts";

export type FlowSummary = {
  id: string;
  name: string;
  status: string;
  tags: string[];
  scenarioCount: number;
  testCaseCount: number;
  scriptCount: number;
  suiteReady: boolean;
  smeApproved: boolean;
};

const DESIGN_ROOT = path.join(repoRoot(), "apps", "automation", "test-design", "flows");
const TESTS_ROOT = path.join(repoRoot(), "apps", "automation", "tests");
const INDEX_PATH = path.join(repoRoot(), "data", "discovery-kb", "flows", "index.yaml");
const META_DIR = path.join(repoRoot(), "data", "discovery-kb", "flows");

function extractSmeReady(raw: string): string[] {
  const block = raw.match(/sme_ready:\s*\n((?:\s+-\s+BF-[^\n]+\n?)+)/);
  if (!block) return [];
  return [...new Set([...block[1].matchAll(/-\s+(BF-[A-Z0-9-]+)/g)].map((m) => m[1]))];
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function countYamlItems(raw: string, listKey: string): number {
  const block = raw.match(new RegExp(`${listKey}:\\s*\\n([\\s\\S]*?)(?:\\n\\w|$)`));
  if (!block) return 0;
  return (block[1].match(/^- id:/gm) || []).length;
}

async function findSpecFiles(flowId: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.includes(flowId) && entry.name.endsWith(".spec.ts")) out.push(full);
    }
  }
  await walk(TESTS_ROOT);
  return out.sort();
}

async function loadFlowMeta(flowId: string): Promise<{ name: string; status: string }> {
  const metaPath = path.join(META_DIR, `${flowId}.yaml`);
  const doc = await readOptional(metaPath);
  if (!doc) return { name: flowId, status: "READY" };
  const name = doc.match(/^flow_name:\s*(.+)$/m)?.[1]?.trim() || flowId;
  const status = doc.match(/^status:\s*(.+)$/m)?.[1]?.trim() || "READY";
  return { name, status };
}

export async function listApprovedFlows(): Promise<FlowSummary[]> {
  const indexRaw = await fs.readFile(INDEX_PATH, "utf8");
  const readyIds = extractSmeReady(indexRaw);
  const flows: FlowSummary[] = [];

  for (const id of readyIds) {
    const meta = await loadFlowMeta(id);
    const designDir = path.join(DESIGN_ROOT, id);
    const scenariosRaw = await readOptional(path.join(designDir, "scenarios.yaml"));
    const testCasesRaw = await readOptional(path.join(designDir, "test-cases.yaml"));
    const suiteRaw = await readOptional(path.join(designDir, "suite.yaml"));
    const scripts = await findSpecFiles(id);

    flows.push({
      id,
      name: meta.name,
      status: meta.status,
      tags: ["@sanity", "@regression"],
      scenarioCount: scenariosRaw ? countYamlItems(scenariosRaw, "scenarios") : 0,
      testCaseCount: testCasesRaw ? countYamlItems(testCasesRaw, "test_cases") : 0,
      scriptCount: scripts.length,
      suiteReady: Boolean(suiteRaw),
      smeApproved: true,
    });
  }

  return flows;
}

function parseScenarioBlocks(raw: string) {
  const parts = raw.split(/\n- id: /).slice(1);
  return parts.map((part) => {
    const id = part.match(/^([^\n]+)/)?.[1]?.trim() || "scenario";
    const title = part.match(/^\s*title:\s*(.+)$/m)?.[1]?.trim();
    const type = part.match(/^\s*type:\s*(.+)$/m)?.[1]?.trim();
    const priority = part.match(/^\s*priority:\s*(.+)$/m)?.[1]?.trim();
    const stepsBlock = part.match(/^\s*steps:\s*\n([\s\S]*?)(?:\n\s*tags:|\n\s*expected|\n- id:|$)/m)?.[1] || "";
    const steps = [...stepsBlock.matchAll(/^\s*-\s+(.+)$/gm)].map((m) => m[1].trim());
    const tags = [...(part.match(/^\s*tags:\s*\n([\s\S]*?)(?:\n\s*\w|$)/m)?.[1]?.matchAll(/^\s*-\s+(.+)$/gm) || [])].map(
      (m) => m[1].trim()
    );
    return { id, title, type, priority, steps, tags };
  });
}

function parseTestCaseBlocks(raw: string) {
  const parts = raw.split(/\n- id: /).slice(1);
  return parts.map((part) => {
    const id = part.match(/^([^\n]+)/)?.[1]?.trim() || "test-case";
    const title = part.match(/^\s*title:\s*(.+)$/m)?.[1]?.trim();
    const type = part.match(/^\s*type:\s*(.+)$/m)?.[1]?.trim();
    const priority = part.match(/^\s*priority:\s*(.+)$/m)?.[1]?.trim();
    const linked = part.match(/^\s*linked_scenario:\s*(.+)$/m)?.[1]?.trim();
    const stepsSummary = part.match(/^\s*steps_summary:\s*(.+)$/m)?.[1]?.trim();
    return { id, title, type, priority, linked, stepsSummary };
  });
}

function parseSuite(raw: string) {
  const suiteId = raw.match(/^suite_id:\s*(.+)$/m)?.[1]?.trim();
  const tags = [...(raw.match(/^\s*tags:\s*\n([\s\S]*?)(?:\n\s*\w|$)/m)?.[1]?.matchAll(/^\s*-\s+(.+)$/gm) || [])].map(
    (m) => m[1].trim()
  );
  const cases = [...(raw.match(/^\s*test_cases:\s*\n([\s\S]*?)(?:\n\s*sanity_subset:|\n\s*runner:|$)/m)?.[1]?.matchAll(/^\s*-\s+(.+)$/gm) || [])].map(
    (m) => m[1].trim()
  );
  const sanity = [
    ...(raw.match(/^\s*sanity_subset:\s*\n([\s\S]*?)(?:\n\s*runner:|$)/m)?.[1]?.matchAll(/^\s*-\s+(.+)$/gm) || []),
  ].map((m) => m[1].trim());
  const command = raw.match(/^\s*command_template:\s*(.+)$/m)?.[1]?.trim();
  return { suiteId, tags, cases, sanity, command };
}

export function yamlSourceSection(title: string, raw: string): string {
  return `## Source (${title})\n\n\`\`\`yaml\n${raw.trim()}\n\`\`\``;
}

export async function getFlowSummary(flowId: string): Promise<FlowSummary | null> {
  const flows = await listApprovedFlows();
  return flows.find((f) => f.id === flowId) || null;
}

export async function getArtifactMarkdown(flowId: string, type: FlowArtifactType): Promise<{ title: string; markdown: string } | null> {
  const summary = await getFlowSummary(flowId);
  if (!summary) return null;

  if (type === "scenarios") {
    const raw = await readOptional(path.join(DESIGN_ROOT, flowId, "scenarios.yaml"));
    if (!raw) return null;
    const blocks = parseScenarioBlocks(raw);
    const lines = [
      `# Scenarios`,
      "",
      `**Flow:** \`${flowId}\` — ${summary.name}`,
      "",
      `${blocks.length} scenario(s)`,
      "",
    ];
    for (const s of blocks) {
      lines.push(`## ${s.id}`, "");
      if (s.title) lines.push(`**${s.title}**`, "");
      if (s.type || s.priority) lines.push(`Type: ${s.type || "—"} · Priority: ${s.priority || "—"}`, "");
      if (s.steps.length) {
        lines.push("### Steps", "");
        for (const step of s.steps) lines.push(`- ${step}`);
        lines.push("");
      }
      if (s.tags.length) lines.push(`Tags: ${s.tags.map((t) => `\`${t}\``).join(", ")}`, "");
    }
    lines.push("", yamlSourceSection("scenarios.yaml", raw));
    return { title: "Scenarios", markdown: lines.join("\n") };
  }

  if (type === "test-cases") {
    const raw = await readOptional(path.join(DESIGN_ROOT, flowId, "test-cases.yaml"));
    if (!raw) return null;
    const blocks = parseTestCaseBlocks(raw);
    const lines = [
      `# Test Cases`,
      "",
      `**Flow:** \`${flowId}\` — ${summary.name}`,
      "",
      `${blocks.length} test case(s)`,
      "",
    ];
    for (const tc of blocks) {
      lines.push(`## ${tc.id}`, "");
      if (tc.title) lines.push(`**${tc.title}**`, "");
      lines.push(`Type: ${tc.type || "—"} · Priority: ${tc.priority || "—"}`, "");
      if (tc.linked) lines.push(`Linked scenario: \`${tc.linked}\``, "");
      if (tc.stepsSummary) lines.push(`Summary: ${tc.stepsSummary}`, "");
      lines.push("");
    }
    lines.push("", yamlSourceSection("test-cases.yaml", raw));
    return { title: "Test Cases", markdown: lines.join("\n") };
  }

  if (type === "suite") {
    const raw = await readOptional(path.join(DESIGN_ROOT, flowId, "suite.yaml"));
    if (!raw) return null;
    const suite = parseSuite(raw);
    const lines = [
      `# Test Suite`,
      "",
      `**Flow:** \`${flowId}\` — ${summary.name}`,
      "",
      `**Suite ID:** \`${suite.suiteId || "—"}\``,
      "",
    ];
    if (suite.tags.length) lines.push(`Tags: ${suite.tags.map((t) => `\`${t}\``).join(", ")}`, "");
    if (suite.cases.length) {
      lines.push("", "## Included test cases", "");
      for (const tc of suite.cases) lines.push(`- \`${tc}\``);
    }
    if (suite.sanity.length) {
      lines.push("", "## Sanity subset", "");
      for (const tc of suite.sanity) lines.push(`- \`${tc}\``);
    }
    if (suite.command) lines.push("", `Runner: \`${suite.command}\``, "");
    lines.push("", yamlSourceSection("suite.yaml", raw));
    return { title: "Test Suite", markdown: lines.join("\n") };
  }

  const scripts = await findSpecFiles(flowId);
  if (!scripts.length) return null;
  const lines = [
    `# Test Scripts`,
    "",
    `**Flow:** \`${flowId}\` — ${summary.name}`,
    "",
    `${scripts.length} Playwright spec file(s)`,
    "",
  ];
  for (const scriptPath of scripts) {
    const rel = path.relative(path.join(repoRoot(), "apps", "automation"), scriptPath).replace(/\\/g, "/");
    const content = await fs.readFile(scriptPath, "utf8");
    lines.push(`## ${rel}`, "", "```typescript", content.trim(), "```", "");
  }
  return { title: "Test Scripts", markdown: lines.join("\n") };
}
