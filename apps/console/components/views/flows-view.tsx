"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";

type FlowSummary = {
  id: string;
  name: string;
  description: string;
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

function tagLabels(flow: FlowSummary): string[] {
  const labels: string[] = [];
  if (flow.scenarioCount > 0) labels.push(`${flow.scenarioCount} SC`);
  if (flow.testCaseCount > 0) labels.push(`${flow.testCaseCount} TC`);
  if (flow.scriptCount > 0) labels.push(`${flow.scriptCount} TS`);
  for (const tag of flow.tags.slice(0, 3)) {
    labels.push(tag.replace(/^@/, "").slice(0, 8).toUpperCase());
  }
  return labels.slice(0, 5);
}

export function FlowsView({ onRunFlow }: { onRunFlow: (goal: string) => void }) {
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ArtifactTab>("scenarios");
  const [markdown, setMarkdown] = useState("");
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

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

  function scrollCarousel(direction: -1 | 1) {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 340, behavior: "smooth" });
  }

  function tabCount(flow: FlowSummary, key: (typeof TABS)[number]["countKey"]) {
    if (key === "suiteReady") return flow.suiteReady ? 1 : 0;
    return flow[key] as number;
  }

  return (
    <div className="flows-view">
      <div className="flows-hero">
        <div className="flows-hero-copy">
          <h2 className="flows-hero-title">Built for how you test</h2>
          <p className="flows-hero-sub">
            {flows.length} SME-approved automation flow{flows.length === 1 ? "" : "s"} from your discovery KB.
            Select a card to inspect scenarios, test cases, scripts, and suite YAML — all real artifacts, no placeholders.
          </p>
        </div>
        <div className="flows-hero-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onRunFlow("run morning sanity check for all flows")}
          >
            Run all sanity ↗
          </button>
          <button type="button" className="flows-nav-btn" aria-label="Scroll left" onClick={() => scrollCarousel(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="flows-nav-btn" aria-label="Scroll right" onClick={() => scrollCarousel(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="flows-carousel-wrap">
        {flows.length === 0 ? (
          <div className="flows-empty-carousel">No approved flows found in the discovery KB.</div>
        ) : (
          <div className="flows-carousel" ref={carouselRef}>
            {flows.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`flow-card-composio${selectedId === f.id ? " active" : ""}`}
                onClick={() => {
                  setSelectedId(f.id);
                  setTab("scenarios");
                }}
              >
                <h3 className="flow-card-composio-title">{f.name}</h3>
                <p className="flow-card-composio-desc">
                  {f.description || `${f.id} — ${f.scenarioCount} scenarios, ${f.testCaseCount} test cases.`}
                </p>
                <div className="flow-card-composio-tray">
                  {tagLabels(f).map((label) => (
                    <span key={label} className="flow-card-composio-tag">
                      {label}
                    </span>
                  ))}
                </div>
                <div className="flow-card-composio-foot">
                  <span>Explore</span>
                  <ArrowRight size={16} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <section className="flows-detail-section">
          <div className="flows-detail-head">
            <div>
              <div className="flows-detail-id mono">{selected.id}</div>
              <h3 className="flows-detail-title">{selected.name}</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.65rem" }}>
              <div className="flows-detail-stats">
                <span>{selected.scenarioCount} scenarios</span>
                <span>{selected.testCaseCount} test cases</span>
                <span>{selected.scriptCount} scripts</span>
                <span>{selected.status}</span>
              </div>
              <button
                type="button"
                className="btn-accent"
                onClick={() => onRunFlow(`run sanity for ${selected.id}`)}
              >
                Run this flow
              </button>
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
            {loadingArtifact && <div className="flows-md-loading">Loading artifact…</div>}
            {!loadingArtifact && artifactError && <div className="alert">{artifactError}</div>}
            {!loadingArtifact && !artifactError && markdown && <FlowMarkdown markdown={markdown} />}
          </div>
        </section>
      )}
    </div>
  );
}
