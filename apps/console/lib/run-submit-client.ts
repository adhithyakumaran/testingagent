import type { AgentRun } from "@/lib/types";

export type SubmitRunPayload = {
  goal: string;
  type: "adhoc" | "sanity";
  channels: string[];
};

export type SubmitRunOutcome =
  | { ok: true; run: AgentRun }
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

export async function submitAgentRun(
  fetchImpl: SubmitRunFetch,
  payload: SubmitRunPayload,
  opts?: { timeoutMs?: number; reconcileOnLock?: boolean }
): Promise<SubmitRunOutcome> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reconcileOnLock = opts?.reconcileOnLock ?? true;

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

  try {
    let { res, json } = await postOnce();

    if (res.status === 409 && reconcileOnLock && json.locked) {
      const listRes = await fetchImpl("/api/runs", {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (listRes.ok) {
        const listJson = (await parseJson(listRes)) as { locked?: boolean };
        if (!listJson.locked) {
          ({ res, json } = await postOnce());
        }
      }
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
    return { ok: true, run };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(message) || e instanceof DOMException) {
      return { ok: false, error: "Request timed out — try again" };
    }
    return { ok: false, error: message || "Network error" };
  }
}
