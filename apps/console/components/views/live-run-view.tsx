"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentRun, TraceEvent } from "@/lib/types";

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

  const running = current?.status === "running" || current?.status === "queued";
  const latestUrl = useMemo(() => {
    if (!current) return "";
    return (
      current.traces.find((t) => t.detail?.includes("http"))?.detail?.match(/https?:[^\s"']+/)?.[0] ||
      "Chrome window on your desktop"
    );
  }, [current]);

  if (!current) {
    return (
      <div className="view-empty">
        <h2>Live Runs</h2>
        <p>
          Start a test from <strong>Ask Agent</strong>. Chrome opens on your desktop — this page only shows the step log.
        </p>
      </div>
    );
  }

  return (
    <div className="live-run-view">
      <div className="view-header">
        <div>
          <h2 className="view-title">{current.goal.slice(0, 80)}</h2>
          <p className="view-subtitle">
            {latestUrl} · {current.conclusion || current.status}
          </p>
        </div>
        <div className={`run-status-pill ${running ? "running" : "done"}`}>
          {running ? (
            <>
              <span className="status-chip running" /> Running — {current.traces.length} steps
            </>
          ) : (
            <>✓ {current.conclusion || "Complete"}</>
          )}
        </div>
      </div>

      <div className="live-run-banner">
        Watch the <strong>Chrome window on your desktop</strong> — tests run there in real time. This panel is the step log only.
      </div>

      <div className="timeline-panel live-timeline-full">
        <div className="timeline-panel-head">EXECUTION STEPS</div>
        <div className="timeline-list">
          {current.traces.map((t: TraceEvent, i) => (
            <div
              key={t.id}
              className={`timeline-item ${i === current.traces.length - 1 && running ? "pending" : "pass"}`}
            >
              <span className="timeline-item-dot" />
              <div>
                <div className="timeline-item-label">{t.message}</div>
                {t.detail && <div className="timeline-item-time mono">{t.detail.slice(0, 160)}</div>}
              </div>
              <span className="timeline-item-time">{new Date(t.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
