"use client";

import { useEffect, useState } from "react";

export function FlowsView({ onRunFlow }: { onRunFlow: (goal: string) => void }) {
  const [flows, setFlows] = useState<{ id: string; name: string; status: string }[]>([]);

  useEffect(() => {
    fetch("/api/flows")
      .then((r) => r.json())
      .then((json) => setFlows(json.flows || []))
      .catch(() => setFlows([]));
  }, []);

  return (
    <div className="flows-view">
      <div className="section-head">
        <div className="section-title">Flow knowledge base</div>
        <button type="button" className="section-link" onClick={() => onRunFlow("list sanity flows")}>
          Ask agent to run
        </button>
      </div>
      <div className="run-list">
        {flows.map((f) => (
          <div key={f.id} className="run-row" onClick={() => onRunFlow(`sanity for ${f.id}`)}>
            <div className="status-pill pass">{f.status}</div>
            <div className="run-name">
              {f.id} — {f.name}
            </div>
            <div className="run-tag mono">@sanity</div>
          </div>
        ))}
      </div>
    </div>
  );
}
