"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/input";

type ApprovalItem = {
  flowId: string;
  status: string;
  scenarios: string;
  testCases: string;
  scripts: string;
};

export function SmeApprovalQueue() {
  const [items, setItems] = useState<ApprovalItem[]>([]);

  useEffect(() => {
    fetch("/api/approval")
      .then((r) => r.json())
      .then((json) => setItems(json.flows || []))
      .catch(() => setItems([]));
  }, []);

  return (
    <section className="scout-panel">
      <div className="scout-panel-head">
        <CheckCircle2 size={16} />
        <span>SME approval queue</span>
        <Badge tone="warn">PENDING</Badge>
      </div>
      <div className="scout-inbox-body">
        <p className="scout-muted">Flows awaiting SME sign-off before production CI runs.</p>
        <ul>
          {items.slice(0, 8).map((item, i) => (
            <li key={`${item.flowId}-${i}`}>
              <strong>{item.flowId}</strong>
              <span>{item.status}</span>
              <p>
                {item.scenarios} scenarios · {item.testCases} cases · {item.scripts} scripts
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function CoveragePanel() {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch("/api/coverage")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <section className="scout-panel">
      <div className="scout-panel-head">
        <Clock size={16} />
        <span>KB & automation coverage</span>
      </div>
      <div className="scout-settings-body">
        <ul>
          <li>READY flows: {String(stats?.readyFlows ?? 19)}</li>
          <li>DRAFT flows: {String(stats?.draftFlows ?? 6)}</li>
          <li>Automated flows: {String(stats?.automatedFlows ?? "—")}</li>
          <li>Negative coverage: {String(stats?.negativeTests ?? 1)} test(s)</li>
          <li>Sanity P0 cases: {String(stats?.sanityCases ?? "—")}</li>
        </ul>
        <p className="scout-rec-note">{String(stats?.note || "Coverage from data/discovery-kb + apps/automation")}</p>
      </div>
    </section>
  );
}

export function RunHistoryPanel() {
  const [runs, setRuns] = useState<{ id: string; goal: string; conclusion?: string; createdAt: string }[]>([]);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((json) => setRuns(json.runs || []))
      .catch(() => setRuns([]));
  }, []);

  return (
    <section className="scout-panel">
      <div className="scout-panel-head">
        {runs[0]?.conclusion === "FAIL" ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
        <span>Run history</span>
      </div>
      <div className="scout-inbox-body">
        {runs.length === 0 ? (
          <p className="scout-muted">No runs yet.</p>
        ) : (
          <ul>
            {runs.slice(0, 6).map((run) => (
              <li key={run.id}>
                <strong>{run.conclusion || "—"}</strong>
                <span>{new Date(run.createdAt).toLocaleString()}</span>
                <p>{run.goal.slice(0, 100)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
