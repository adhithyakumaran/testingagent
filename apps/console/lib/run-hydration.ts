import { applyOrchestratorResultToRun } from "@/lib/orchestrator-bridge";
import { parseInsights } from "@/lib/parse-run-insights";
import { fetchWarmAgentRunResult, pollWarmAgentRunResult } from "@/lib/warm-agent-client";
import type { AgentRun } from "@/lib/types";

export function runNeedsAgentHydration(run: AgentRun): boolean {
  const bridgeFailed = run.reasonCode === "console.orchestrator_bridge_fallback";
  const agent = run.report?.json?.agent as Record<string, unknown> | null | undefined;
  if (!agent) {
    return bridgeFailed || run.status === "running" || run.status === "failed";
  }
  const local = (agent.local as Record<string, unknown> | undefined) || {};
  const execution = local.execution as Record<string, unknown> | undefined;
  const hasInsights = Boolean(parseInsights(run).primaryExecutableFlow || parseInsights(run).evidence?.length);
  if (bridgeFailed) return true;
  if (!execution || !Object.keys(execution).length) return !hasInsights;
  return false;
}

export function countEvidenceCaptures(run: AgentRun | null): number {
  return parseInsights(run).evidence?.length ?? 0;
}

export async function hydrateRunFromWarmAgent(
  run: AgentRun,
  opts?: { allowPoll?: boolean }
): Promise<AgentRun> {
  if (!runNeedsAgentHydration(run)) return run;

  const immediate = await fetchWarmAgentRunResult(run.id);
  let result: Record<string, unknown> | undefined;
  if (immediate?.httpStatus === 200 && immediate.body.status === "completed" && immediate.body.result) {
    result = immediate.body.result as Record<string, unknown>;
  } else if (
    opts?.allowPoll &&
    (immediate?.httpStatus === 202 || immediate?.body.status === "running")
  ) {
    const polled = await pollWarmAgentRunResult(run.id, { deadlineMs: 5_000, intervalMs: 500 });
    if (polled.ok && polled.result) result = polled.result;
  }

  if (!result) return run;

  const traces = [...run.traces];
  const hydrated = applyOrchestratorResultToRun({ ...run, traces }, result, traces);
  if (run.reasonCode === "console.orchestrator_bridge_fallback") {
    hydrated.reasonCode = String(result.reason_code || hydrated.reasonCode || "");
  }
  return hydrated;
}
