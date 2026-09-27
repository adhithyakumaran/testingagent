"use client";

import { useEffect, useRef } from "react";
import type { AgentRun } from "@/lib/types";
import { isRunTerminal } from "@/lib/run-display";

const POLL_MS = 2500;
export const RUN_FETCH_TIMEOUT_MS = 45_000;

export type FetchRunResult =
  | { ok: true; run: AgentRun }
  | { ok: false; error: "http_error" | "network_error" | "invalid_payload"; status?: number; message?: string };

export async function fetchRunById(id: string, fetchImpl: typeof fetch = fetch): Promise<FetchRunResult> {
  try {
    const res = await fetchImpl(`/api/runs/${encodeURIComponent(id)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(RUN_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: "http_error", status: res.status };
    }
    const json = (await res.json()) as { run?: AgentRun };
    if (!json.run) {
      return { ok: false, error: "invalid_payload", status: res.status };
    }
    return { ok: true, run: json.run };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "network_error", message };
  }
}

async function fetchRunWithRetry(id: string, attempts = 3): Promise<AgentRun | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outcome = await fetchRunById(id);
    if (outcome.ok) return outcome.run;
    if (outcome.error === "network_error" && attempt < attempts - 1) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    if (outcome.error === "http_error" && outcome.status && outcome.status >= 500 && attempt < attempts - 1) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    return null;
  }
  return null;
}

async function fetchLatestRun(): Promise<AgentRun | null> {
  try {
    const res = await fetch("/api/runs", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(RUN_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { runs?: AgentRun[] };
    return json.runs?.[0] || null;
  } catch {
    return null;
  }
}

/** Keep latest-run card aligned with persisted run state (poll until terminal). */
export function useLatestRunSync(
  activeRun: AgentRun | null,
  setActiveRun: (run: AgentRun | null) => void
) {
  const runId = activeRun?.id;
  const terminal = isRunTerminal(activeRun);
  const mounted = useRef(true);
  const pollInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (activeRun?.id) return;
      const latest = await fetchLatestRun();
      if (!cancelled && mounted.current && latest) {
        setActiveRun(latest);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [activeRun?.id, setActiveRun]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const fresh = await fetchRunWithRetry(runId as string, terminal ? 4 : 2);
        if (!cancelled && mounted.current && fresh) {
          setActiveRun(fresh);
          if (isRunTerminal(fresh)) {
            if (timer !== undefined) {
              window.clearInterval(timer);
              timer = undefined;
            }
          }
        }
      } finally {
        pollInFlight.current = false;
      }
    }

    void poll();
    if (terminal) {
      return () => {
        cancelled = true;
      };
    }

    timer = window.setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [runId, terminal, setActiveRun]);
}

export function syncRunFromApi(runId: string, setActiveRun: (run: AgentRun) => void) {
  return fetchRunWithRetry(runId).then((run) => {
    if (run) setActiveRun(run);
    return run;
  });
}
