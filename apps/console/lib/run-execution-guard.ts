import type { AgentRun, TraceEvent } from "@/lib/types";

const BRIDGE_PREFIX = "Orchestrator bridge via";

export function orchestrationBridgeRecorded(traces: TraceEvent[]): boolean {
  return traces.some((t) => typeof t.message === "string" && t.message.startsWith(BRIDGE_PREFIX));
}

/** Console run already invoked the Python/warm orchestrator — must not execute again. */
export function shouldSkipDuplicateOrchestration(run: AgentRun): boolean {
  return orchestrationBridgeRecorded(run.traces);
}

export function findRecentRunWithGoal(runs: AgentRun[], goal: string, maxAgeMs = 180_000): AgentRun | undefined {
  const normalized = goal.trim().toLowerCase();
  if (!normalized) return undefined;
  const now = Date.now();
  for (const run of runs) {
    if (run.goal.trim().toLowerCase() !== normalized) continue;
    const created = Date.parse(run.createdAt);
    if (!Number.isFinite(created) || now - created > maxAgeMs) continue;
    return run;
  }
  return undefined;
}
