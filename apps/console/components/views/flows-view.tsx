"use client";

import { useCallback, useEffect, useState } from "react";

type FlowSummary = {
  id: string;
  name: string;
  status: string;
  tags: string[];
  scenarioCount: number;
  testCaseCount: number;
  scriptCount: number;
  suiteReady: boolean;
  smeApproved: boolean;
};

type ArtifactTab = "scenarios" | "test-cases" | "suite" | "scripts";

const TABS: { id: ArtifactTab; label: string; countKey: keyof FlowSummary | "suiteReady" }[] = [
  { id: "scenarios", label: "Scenarios", countKey: "scenarioCount" },
  { id: "test-cases", label: "Test Cases", countKey: "testCaseCount" },
  { id: "scripts", label: "Test Scripts", countKey: "scriptCount" },
  { id: "suite", label: "Test Suite", countKey: "suiteReady" },
];

function FlowMarkdown({ markdown }: { markdown: string }) {
  const chunks = markdown.split("```");
  return (
    <div className="flow-md">
      {chunks.map((chunk, i) => {
        if (i % 2 === 1) {
          const nl = chunk.indexOf("\n");
          const code = (nl >= 0 ? chunk.slice(nl + 1) : chunk).trim();
          return (
            <pre key={i} className="flow-md-code">
              <code>{code}</code>
            </pre>
          );
        }
        return null;
      })}
    </div>
  );
}

export function FlowsView({ onRunFlow }: { onRunFlow: (goal: string) => void }) {
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ArtifactTab>("scenarios");
  const [markdown, setMarkdown] = useState("");
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/flows")
      .then((r) => r.json())
      .then((json) => {
        const list = (json.flows || []) as FlowSummary[];
        setFlows(list);
        setSelectedId((prev) => prev || list[0]?.id || null);
      })
      .catch(() => setFlows([]));
  }, []);

  const selected = flows.find((f) => f.id === selectedId) || null;

  const loadArtifact = useCallback(async (flowId: string, artifact: ArtifactTab) => {
    setLoadingArtifact(true);
    setArtifactError(null);
    setMarkdown("");
    try {
      const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}/artifact?type=${artifact}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load artifact");
      setMarkdown(json.markdown || "");
    } catch (e) {
      setArtifactError(e instanceof Error ? e.message : "Could not load artifact");
    } finally {
      setLoadingArtifact(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadArtifact(selectedId, tab);
  }, [selectedId, tab, loadArtifact]);

  function tabCount(flow: FlowSummary, key: (typeof TABS)[number]["countKey"]) {
    if (key === "suiteReady") return flow.suiteReady ? 1 : 0;
    return flow[key] as number;
  }

  return (
    <div className="flows-view">
      <div className="flows-header">
        <div>
          <h2 className="view-title">Flows &amp; Suites</h2>
          <p className="view-subtitle">
            {flows.length} SME-approved flow{flows.length === 1 ? "" : "s"} · tap a flow to inspect design artifacts
          </p>
        </div>
        {selected && (
          <button type="button" className="chat-cta primary" onClick={() => onRunFlow(`run sanity for ${selected.id}`)}>
            Run this flow
          </button>
        )}
      </div>

      <div className="flows-layout">
        <aside className="flows-list-panel">
          <div className="flows-count-card">
            <span className="flows-count-num">{flows.length}</span>
            <span className="flows-count-label">Approved flows</span>
          </div>
          <div className="flows-list">
            {flows.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`flow-card${selectedId === f.id ? " active" : ""}`}
                onClick={() => {
                  setSelectedId(f.id);
                  setTab("scenarios");
                }}
              >
                <div className="flow-card-top">
                  <span className="flow-card-id mono">{f.id}</span>
                  <span className="status-pill pass">{f.status}</span>
                </div>
                <div className="flow-card-name">{f.name}</div>
                <div className="flow-card-meta">
                  {f.scenarioCount} sc · {f.testCaseCount} tc · {f.scriptCount} scripts
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="flows-detail-panel">
          {!selected ? (
            <div className="view-empty">
              <p>Select a flow to view scenarios, test cases, scripts, and suite definition.</p>
            </div>
          ) : (
            <>
              <div className="flows-detail-head">
                <div>
                  <div className="flows-detail-id mono">{selected.id}</div>
                  <h3 className="flows-detail-title">{selected.name}</h3>
                </div>
                <div className="flows-detail-stats">
                  <span>{selected.scenarioCount} scenarios</span>
                  <span>{selected.testCaseCount} test cases</span>
                  <span>{selected.scriptCount} scripts</span>
                </div>
              </div>

              <div className="flows-artifact-tabs">
                {TABS.map((t) => {
                  const count = tabCount(selected, t.countKey);
                  const disabled = t.id === "suite" ? !selected.suiteReady : count === 0;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`flows-artifact-tab${tab === t.id ? " active" : ""}`}
                      disabled={disabled}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                      <span className="flows-tab-count">{count || "—"}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flows-md-panel">
                {loadingArtifact && <div className="flows-md-loading">Loading markdown view…</div>}
                {!loadingArtifact && artifactError && <div className="alert">{artifactError}</div>}
                {!loadingArtifact && !artifactError && markdown && <FlowMarkdown markdown={markdown} />}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
