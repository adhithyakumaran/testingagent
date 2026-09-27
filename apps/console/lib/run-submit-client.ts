import type { AgentRun } from "@/lib/types";
import { findRecentRunWithGoal } from "@/lib/run-execution-guard";
import { emitRunSubmitDiagnostic } from "@/lib/run-submit-diagnostics";

export type SubmitRunPayload = {
  goal: string;
  type: "adhoc" | "sanity";
  channels: string[];
};

export type SubmitRunOutcome =
  | { ok: true; run: AgentRun; attached?: boolean }
  | { ok: false; error: string; locked?: boolean; activeRunId?: string };

export type SubmitRunFetch = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 60_000;

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fetchRunsList(fetchImpl: SubmitRunFetch, timeoutMs: number) {
  const listRes = await fetchImpl("/api/runs", {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!listRes.ok) return null;
  const listJson = (await parseJson(listRes)) as { runs?: AgentRun[]; locked?: boolean };
  return listJson;
}

async function fetchRunById(fetchImpl: SubmitRunFetch, runId: string, timeoutMs: number): Promise<AgentRun | null> {
  const res = await fetchImpl(`/api/runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const json = (await parseJson(res)) as { run?: AgentRun };
  return json.run || null;
}

function activeRunFromList(runs: AgentRun[] | undefined): AgentRun | undefined {
  return runs?.find((r) => r.status === "queued" || r.status === "running" || r.status === "resuming");
}

export async function submitAgentRun(
  fetchImpl: SubmitRunFetch,
  payload: SubmitRunPayload,
  opts?: { timeoutMs?: number; reconcileOnLock?: boolean }
): Promise<SubmitRunOutcome> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reconcileOnLock = opts?.reconcileOnLock ?? true;

  emitRunSubmitDiagnostic("USER_SUBMIT", `goal="${payload.goal.slice(0, 80)}"`);

  const postOnce = async (): Promise<{ res: Response; json: Record<string, unknown> }> => {
    const res = await fetchImpl("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await parseJson(res);
    return { res, json };
  };

  const attachExisting = async (run: AgentRun, reason: string): Promise<SubmitRunOutcome> => {
    emitRunSubmitDiagnostic("RUN_ATTACH_EXISTING", `run_id=${run.id} reason=${reason}`);
    return { ok: true, run, attached: true };
  };

  try {
    let { res, json } = await postOnce();

    if (res.status === 409 && reconcileOnLock) {
      const activeRunId = json.activeRunId ? String(json.activeRunId) : undefined;
      if (activeRunId) {
        const existing = await fetchRunById(fetchImpl, activeRunId, timeoutMs);
        if (existing) {
          return attachExisting(existing, "409_active_run_id");
        }
      }
      const listJson = await fetchRunsList(fetchImpl, timeoutMs);
      const active = activeRunFromList(listJson?.runs);
      if (active) {
        return attachExisting(active, "409_active_run_in_list");
      }
      const recent = findRecentRunWithGoal(listJson?.runs || [], payload.goal);
      if (recent) {
        return attachExisting(recent, "409_recent_same_goal");
      }
      emitRunSubmitDiagnostic(
        "RUN_RESUBMIT_ATTEMPT",
        "blocked — lock cleared but no existing run to attach; not creating a second run"
      );
    }

    if (res.status === 409) {
      return {
        ok: false,
        locked: true,
        error: String(json.error || "Another run is in progress."),
        activeRunId: json.activeRunId ? String(json.activeRunId) : undefined,
      };
    }

    if (!res.ok) {
      return { ok: false, error: String(json.error || "Run failed") };
    }

    const run = json.run as AgentRun | undefined;
    if (!run) {
      return { ok: false, error: "Run failed — missing run payload" };
    }
    emitRunSubmitDiagnostic("RUN_CREATED", `run_id=${run.id}`);
    return { ok: true, run };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(message) || e instanceof DOMException) {
      const listJson = await fetchRunsList(fetchImpl, timeoutMs);
      const active = activeRunFromList(listJson?.runs);
      if (active) {
        return attachExisting(active, "timeout_active_run");
      }
      const recent = findRecentRunWithGoal(listJson?.runs || [], payload.goal);
      if (recent) {
        return attachExisting(recent, "timeout_recent_same_goal");
      }
      return { ok: false, error: "Request timed out — try again" };
    }
    return { ok: false, error: message || "Network error" };
  }
}
