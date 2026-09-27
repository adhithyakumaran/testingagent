import { fetchInternalAgent, internalAgentHeaders } from "@/lib/internal-agent";

const LOCAL_AGENT_URL = process.env.LOCAL_AGENT_URL || "http://127.0.0.1:43124";

export type WarmAgentPollOutcome = {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  via?: string;
  runId?: string;
};

export async function fetchWarmAgentRunResult(
  runId: string,
  init?: RequestInit
): Promise<{ httpStatus: number; body: Record<string, unknown> } | null> {
  try {
    const res = await fetchInternalAgent(`/agent/${encodeURIComponent(runId)}/result`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      ...init,
    });
    const body = (await res.json()) as Record<string, unknown>;
    return { httpStatus: res.status, body };
  } catch {
    return null;
  }
}

export async function pollWarmAgentRunResult(
  runId: string,
  opts: { deadlineMs?: number; intervalMs?: number } = {}
): Promise<WarmAgentPollOutcome> {
  const deadline = Date.now() + (opts.deadlineMs ?? 120_000);
  const intervalMs = opts.intervalMs ?? 2_000;
  while (Date.now() < deadline) {
    const polled = await fetchWarmAgentRunResult(runId);
    if (!polled) {
      await sleep(intervalMs);
      continue;
    }
    const { httpStatus, body } = polled;
    if (httpStatus === 404) {
      return { ok: false, error: "warm_agent_run_not_found", via: "warm-poll", runId };
    }
    const status = String(body.status || "");
    if (status === "failed") {
      return {
        ok: false,
        error: String(body.error || "warm_agent_failed"),
        via: "warm-poll",
        runId,
      };
    }
    if (status === "completed" && body.result && typeof body.result === "object") {
      return {
        ok: true,
        result: body.result as Record<string, unknown>,
        via: "warm-poll",
        runId,
      };
    }
    await sleep(intervalMs);
  }
  return { ok: false, error: "warm_agent_result_timeout", via: "warm-poll", runId };
}

export async function postWarmAgentRun(
  goal: string,
  opts: {
    runType: string;
    model: string;
    contextPackets: Record<string, unknown>[];
    runId?: string;
    executionMode?: string;
  }
): Promise<WarmAgentPollOutcome & { accepted?: boolean }> {
  const runId = opts.runId;
  try {
    const res = await fetch(`${LOCAL_AGENT_URL}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalAgentHeaders()),
      },
      body: JSON.stringify({
        goal,
        run_type: opts.runType,
        run_id: runId,
        model: opts.model === "disabled" ? null : opts.model,
        context_packets: opts.contextPackets,
        execution_mode: opts.executionMode ?? "LIVE_DEMO",
        skip_execution: false,
        allow_skip_execution: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (res.status === 202) {
      const acceptedRunId = String(json.run_id || runId || "");
      if (!acceptedRunId) {
        return { ok: false, error: "warm_agent_accept_missing_run_id", via: "warm-accept" };
      }
      const polled = await pollWarmAgentRunResult(acceptedRunId);
      return { ...polled, accepted: true, runId: acceptedRunId };
    }
    if (!res.ok) {
      return { ok: false, error: `warm_agent_http_${res.status}`, via: "warm" };
    }
    if (json.ok && json.result && typeof json.result === "object") {
      return {
        ok: true,
        result: json.result as Record<string, unknown>,
        via: "warm",
        runId: String(json.run_id || runId || ""),
      };
    }
    return { ok: false, error: String(json.error || "warm_agent_bad_payload"), via: "warm" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (runId) {
      const recovered = await pollWarmAgentRunResult(runId);
      if (recovered.ok) {
        return { ...recovered, via: "warm-disconnect-recover" };
      }
      const probe = await fetchWarmAgentRunResult(runId);
      if (probe && probe.httpStatus !== 404) {
        return {
          ok: false,
          error: recovered.error || message,
          via: "warm-disconnect-active",
          runId,
        };
      }
    }
    return { ok: false, error: message, via: "warm" };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
