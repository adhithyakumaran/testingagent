"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Monitor, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type LiveEvent = {
  sequence?: number;
  phase?: string;
  action?: string;
  target?: string;
  value_summary?: string;
  status?: string;
  duration_ms?: number;
  timestamp?: string;
};

type Props = {
  runId: string | null;
  goal?: string;
  flowId?: string;
  runStatus?: string;
  conclusion?: string;
  liveMode?: boolean;
};

function mergeEvents(prev: LiveEvent[], row: LiveEvent): LiveEvent[] {
  const seq = row.sequence;
  if (seq == null || seq <= 0) return prev;
  if (prev.some((p) => p.sequence === seq)) return prev;
  return [...prev, row];
}

function sortBySequence(events: LiveEvent[]): LiveEvent[] {
  const bySeq = new Map<number, LiveEvent>();
  for (const ev of events) {
    if (ev.sequence != null && ev.sequence > 0) {
      bySeq.set(ev.sequence, ev);
    }
  }
  return [...bySeq.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

export function LiveRunPanel({ runId, goal, flowId, runStatus, conclusion, liveMode }: Props) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = runStatus === "running" || runStatus === "queued";
  const sessionStatus = String(session?.status || "UNKNOWN");
  const sessionClosed = sessionStatus === "CLOSED";

  const orderedEvents = useMemo(() => sortBySequence(events), [events]);

  useEffect(() => {
    if (!runId || !liveMode) return;
    let cancelled = false;
    const source = new EventSource(`/api/runs/${runId}/stream`);
    source.onmessage = (msg) => {
      if (cancelled) return;
      try {
        const row = JSON.parse(msg.data) as LiveEvent;
        setEvents((prev) => mergeEvents(prev, row));
      } catch {
        /* ignore */
      }
    };
    source.onerror = () => {
      if (!cancelled) setError("Live stream disconnected");
    };
    return () => {
      cancelled = true;
      source.close();
    };
  }, [runId, liveMode]);

  const refreshSession = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(`/api/runs/${runId}/browser`, { cache: "no-store" });
      if (res.ok) setSession(await res.json());
    } catch {
      setSession(null);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId || !liveMode) return;
    refreshSession();
    const intervalMs = sessionClosed ? 10_000 : 1500;
    const t = setInterval(refreshSession, intervalMs);
    return () => clearInterval(t);
  }, [runId, liveMode, refreshSession, sessionClosed]);

  async function closeBrowser() {
    if (!runId || sessionClosed) return;
    await fetch(`/api/runs/${runId}/browser/close`, { method: "POST" });
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        const res = await fetch(`/api/runs/${runId}/browser`, { cache: "no-store" });
        if (!res.ok) continue;
        const body = (await res.json()) as Record<string, unknown>;
        setSession(body);
        if (body.status === "CLOSED") break;
      } catch {
        /* retry */
      }
    }
  }

  const keepOpenMessage = useMemo(() => {
    if (sessionClosed) return null;
    if (conclusion === "PASS" && session?.keep_open) {
      return "Browser remains open for inspection.";
    }
    return null;
  }, [conclusion, session, sessionClosed]);

  if (!liveMode || !runId) return null;

  return (
    <section className="panel live-run-panel" aria-label="Live browser run">
      <header className="live-run-header">
        <div>
          <p className="live-run-kicker">{active ? "RUNNING" : "RUN COMPLETE"}</p>
          <h2>{goal || "Live QA run"}</h2>
          {flowId ? <p className="live-run-flow">{flowId}</p> : null}
        </div>
        <div className="live-run-badges">
          <span className="badge-live">
            <Monitor size={14} aria-hidden /> LIVE BROWSER
          </span>
          <span>{String(session?.channel || "Chrome")} • APEX</span>
        </div>
      </header>

      <ul className="live-event-list">
        {orderedEvents.map((ev) => (
          <li key={ev.sequence}>
            <span
              className={`live-event-status live-event-${(ev.status || "OK").toLowerCase()}`}
              title={ev.status || "OK"}
            >
              {ev.status === "FAIL"
                ? "✗"
                : ev.status === "STARTED"
                  ? "…"
                  : ev.status === "OK" || !ev.status
                    ? "✓"
                    : "●"}
            </span>
            <span className="live-event-phase">{ev.phase}</span>
            <span className="live-event-action">{ev.action}</span>
            {ev.target ? <span className="live-event-target">{ev.target}</span> : null}
            {ev.value_summary ? <span className="live-event-value">{ev.value_summary}</span> : null}
            {ev.duration_ms ? <span className="live-event-duration">{ev.duration_ms}ms</span> : null}
          </li>
        ))}
        {active && orderedEvents.length === 0 ? (
          <li className="live-event-wait">
            <Loader2 className="spin" size={16} aria-hidden /> Waiting for live browser actions…
          </li>
        ) : null}
      </ul>

      <footer className="live-run-footer">
        <div>
          <strong>Browser session:</strong> {sessionStatus}
          {session?.current_url ? (
            <div className="live-run-url">Current URL: {String(session.current_url)}</div>
          ) : null}
        </div>
        {keepOpenMessage ? <p className="live-run-complete">{keepOpenMessage}</p> : null}
        {sessionClosed || (!active && session?.keep_open !== true) ? (
          <p className="live-run-complete">Browser session closed.</p>
        ) : null}
        {error ? <p className="live-run-error">{error}</p> : null}
        {session?.keep_open === true ? (
          <Button type="button" variant="secondary" onClick={closeBrowser} disabled={sessionClosed}>
            <XCircle size={16} aria-hidden /> Close Browser
          </Button>
        ) : null}
      </footer>
    </section>
  );
}
