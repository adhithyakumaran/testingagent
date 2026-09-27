import type { AgentRun, AppState } from "@/lib/types";
import { mapConclusionToRunStatus } from "@/lib/run-resume";
import { uid } from "@/lib/utils";

export const ACTIVE_RUN_STATUSES: ReadonlySet<AgentRun["status"]> = new Set([
  "queued",
  "running",
  "resuming",
]);

/** Queued runs should transition to running almost immediately once finishRun starts. */
export const QUEUED_STALE_MS = 30_000;

/** Slightly above warm-agent / spawn execution timeout (120s). */
export const ACTIVE_EXECUTION_STALE_MS = 130_000;

export type AgentRunProbe =
  | { kind: "missing" }
  | { kind: "unreachable" }
  | { kind: "active"; status: string }
  | { kind: "terminal"; status: string; conclusion?: string; reasonCode?: string };

export type ReconcileClock = () => number;

export function isActiveRunStatus(status: AgentRun["status"]): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

export function hasActiveRun(state: AppState): boolean {
  return state.runs.some((r) => isActiveRunStatus(r.status));
}

export function findActiveRun(state: AppState): AgentRun | undefined {
  return state.runs.find((r) => isActiveRunStatus(r.status));
}

function parseTime(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
}

function agentStatusIsActive(status: string): boolean {
  const s = status.toUpperCase();
  if (s === "WAITING_FOR_APPROVAL") return false;
  if (["COMPLETED", "FAILED", "BLOCKED", "NEEDS_REVIEW", "PASS", "FAIL"].includes(s)) return false;
  return true;
}

function agentStatusIsTerminal(status: string): boolean {
  return !agentStatusIsActive(status);
}

export function failActiveRun(
  run: AgentRun,
  reasonCode: string,
  message: string,
  at: string
): void {
  run.status = "failed";
  run.conclusion = run.conclusion || "FAIL";
  run.reasonCode = reasonCode;
  run.updatedAt = at;
  run.traces.push({
    id: uid("tr"),
    at,
    kind: "error",
    message,
    detail: reasonCode,
  });
}

export function applyAgentTerminalToRun(run: AgentRun, probe: AgentRunProbe & { kind: "terminal" }, at: string): void {
  const conclusion = probe.conclusion || probe.status;
  run.conclusion = conclusion;
  run.reasonCode = probe.reasonCode || run.reasonCode;
  run.status = mapConclusionToRunStatus(conclusion);
  run.updatedAt = at;
  run.traces.push({
    id: uid("tr"),
    at,
    kind: "info",
    message: `Run lock released — agent reported ${probe.status}`,
    detail: probe.reasonCode,
  });
}

export type ReconcileResult = { changed: boolean; releasedRunIds: string[] };

/**
 * Release console command locks for runs that are no longer executing on the agent
 * or whose finishRun worker never advanced past queued.
 */
export function reconcileActiveRuns(
  state: AppState,
  probe: (runId: string) => AgentRunProbe,
  nowMs: ReconcileClock = () => Date.now()
): ReconcileResult {
  const now = nowMs();
  const releasedRunIds: string[] = [];
  let changed = false;

  for (const run of state.runs) {
    if (!isActiveRunStatus(run.status)) continue;

    const createdAt = parseTime(run.createdAt, now);
    const updatedAt = parseTime(run.updatedAt, createdAt);
    const ageMs = now - createdAt;
    const idleMs = now - updatedAt;

    if (run.status === "queued" && ageMs >= QUEUED_STALE_MS) {
      failActiveRun(run, "console.run_stale_queued", "Stale queued run released — execution never started", new Date(now).toISOString());
      releasedRunIds.push(run.id);
      changed = true;
      continue;
    }

    const agent = probe(run.id);

    if (agent.kind === "terminal") {
      applyAgentTerminalToRun(run, agent, new Date(now).toISOString());
      releasedRunIds.push(run.id);
      changed = true;
      continue;
    }

    if (agent.kind === "missing") {
      const graceMs = run.status === "queued" ? 5_000 : 15_000;
      if (ageMs >= graceMs) {
        failActiveRun(
          run,
          "console.run_orphaned",
          "Stale active run released — no matching agent execution",
          new Date(now).toISOString()
        );
        releasedRunIds.push(run.id);
        changed = true;
      }
      continue;
    }

    if (agent.kind === "unreachable") {
      if (run.status === "queued" && ageMs >= QUEUED_STALE_MS) {
        failActiveRun(
          run,
          "console.run_agent_unreachable",
          "Stale queued run released — agent unreachable during reconciliation",
          new Date(now).toISOString()
        );
        releasedRunIds.push(run.id);
        changed = true;
      } else if (idleMs >= ACTIVE_EXECUTION_STALE_MS) {
        failActiveRun(
          run,
          "console.run_stale_execution",
          "Stale active run released — execution timed out",
          new Date(now).toISOString()
        );
        releasedRunIds.push(run.id);
        changed = true;
      }
      continue;
    }

    if (agent.kind === "active" && idleMs >= ACTIVE_EXECUTION_STALE_MS) {
      failActiveRun(
        run,
        "console.run_stale_execution",
        "Stale active run released — exceeded maximum execution window",
        new Date(now).toISOString()
      );
      releasedRunIds.push(run.id);
      changed = true;
    }
  }

  return { changed, releasedRunIds };
}

export function agentProbeFromJson(
  status: number,
  body: Record<string, unknown> | null
): AgentRunProbe {
  if (status === 404) return { kind: "missing" };
  if (!body || status < 200 || status >= 300) return { kind: "unreachable" };
  const agentStatus = String(body.status || body.final_result || "");
  if (!agentStatus) return { kind: "unreachable" };
  if (agentStatusIsTerminal(agentStatus)) {
    return {
      kind: "terminal",
      status: agentStatus,
      conclusion: String(body.final_result || body.status || ""),
      reasonCode: body.reason_code ? String(body.reason_code) : undefined,
    };
  }
  return { kind: "active", status: agentStatus };
}
