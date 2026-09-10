"use client";

import { useEffect, useState } from "react";
import type { AgentRun, TraceEvent } from "@/lib/types";

function evidenceFromRun(run: AgentRun | null) {
  if (!run?.report?.json) return [];
  const agent = run.report.json.agent as Record<string, unknown> | null | undefined;
  const local = (agent?.local as Record<string, unknown>) || {};
  const execution = (local.execution as Record<string, unknown>) || {};
  const observations = Array.isArray(execution.observations)
    ? (execution.observations as { meta?: { evidence?: { path: string; label?: string }[] } }[])
    : [];
  const out: { path: string; label?: string }[] = [];
  for (const obs of observations) {
    for (const ev of obs.meta?.evidence || []) out.push(ev);
  }
  return out.slice(0, 8);
}

export function LiveRunView({
  run,
  onRunUpdate,
}: {
  run: AgentRun | null;
  onRunUpdate: (run: AgentRun) => void;
}) {
  const [current, setCurrent] = useState<AgentRun | null>(run);

  useEffect(() => setCurrent(run), [run]);

  useEffect(() => {
    if (!current?.id) return;
    if (current.status !== "running" && current.status !== "queued") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${current.id}`);
        if (!res.ok) return;
        const { run: updated } = (await res.json()) as { run: AgentRun };
        setCurrent(updated);
        onRunUpdate(updated);
      } catch {
        /* ignore */
      }
    }, 800);
    return () => clearInterval(timer);
  }, [current?.id, current?.status, onRunUpdate]);

  if (!current) {
    return (
      <div className="view-empty">
        <h2>Live Runs</h2>
        <p>Start a test from <strong>Ask Agent</strong> — Scout opens a visible Chrome window and streams steps here.</p>
      </div>
    );
  }

  const evidence = evidenceFromRun(current);
  const running = current.status === "running" || current.status === "queued";
  const latestUrl =
    current.traces.find((t) => t.detail?.includes("http"))?.detail?.match(/https?:[^\s"']+/)?.[0] ||
    "dev-ea.titanrts.com/ords/r/tjdcom/ea";

  return (
    <div className="live-run-view">
      <div className="run-header">
        <div className="run-header-left">
          <h2>{current.goal.slice(0, 80)}</h2>
          <div className="meta">
            Endless Aisle UAT · <span className="mono">{latestUrl}</span> · {current.conclusion || current.status}
          </div>
        </div>
        <div className={`run-progress-pill ${running ? "" : "done"}`}>
          {running ? (
            <>
              <div className="spinner" /> Running — {current.traces.length} steps logged
            </>
          ) : (
            <>✓ {current.conclusion || "Complete"}</>
          )}
        </div>
      </div>

      <div className="live-split">
        <div className="browser-frame">
          <div className="browser-chrome">
            <div className="browser-dots">
              <span />
              <span />
              <span />
            </div>
            <div className="browser-url mono">{latestUrl}</div>
          </div>
          <div className="browser-body">
            {evidence.length > 0 ? (
              <div className="evidence-strip">
                {evidence.map((ev) => (
                  <figure key={ev.path}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/evidence?path=${encodeURIComponent(ev.path)}`} alt={ev.label || "step"} />
                    <figcaption>{ev.label || ev.path.split("/").pop()}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="browser-placeholder">
                <p>{running ? "Chrome window is open on your machine — watch login, navigation, and clicks live." : "Run complete — evidence captures appear here when available."}</p>
              </div>
            )}
          </div>
        </div>

        <div className="timeline-panel">
          <div className="tl-head">EXECUTION STEPS</div>
          {current.traces.map((t: TraceEvent, i) => (
            <div
              key={t.id}
              className={`tl-step ${i === current.traces.length - 1 && running ? "active" : "done"}`}
            >
              <div className="tl-marker">
                {i === current.traces.length - 1 && running ? <div className="spinner" /> : "✓"}
              </div>
              <div className="tl-body">
                <div className="tl-title">{t.message}</div>
                {t.detail && <div className="tl-sub mono">{t.detail.slice(0, 120)}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
