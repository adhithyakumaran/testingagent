"use client";

import { useEffect, useState } from "react";
import type { AgentRun, HistoryItem } from "@/lib/types";

export function HistoryView() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((json) => {
        setRuns(json.runs || []);
        setHistory(json.history || []);
      })
      .catch(() => {
        setRuns([]);
        setHistory([]);
      });
  }, []);

  return (
    <div className="history-view">
      <div className="section-head">
        <div className="section-title">Recent activity</div>
      </div>
      <div className="run-list">
        {runs.slice(0, 20).map((run) => (
          <div key={run.id} className="run-row">
            <div
              className={`status-pill ${
                run.conclusion === "PASS" ? "pass" : run.conclusion === "FAIL" ? "fail" : "running"
              }`}
            >
              {run.conclusion || run.status}
            </div>
            <div className="run-name">{run.goal.slice(0, 72)}</div>
            <div className="run-tag mono">{run.type}</div>
            <div className="run-meta">{new Date(run.createdAt).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="section-head">
        <div className="section-title">Audit log</div>
      </div>
      <div className="run-list">
        {history.slice(0, 30).map((h) => (
          <div key={h.id} className="run-row">
            <div className="run-name">{h.action}</div>
            <div className="run-tag mono">{h.actor}</div>
            <div className="run-meta">{new Date(h.at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
