"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { ChatAgentView } from "@/components/views/chat-agent-view";
import { LiveRunView } from "@/components/views/live-run-view";
import { RecorderView } from "@/components/views/recorder-view";
import { HistoryView } from "@/components/views/history-view";
import { FlowsView } from "@/components/views/flows-view";
import { ConnectorsView } from "@/components/views/connectors-view";
import { ApprovalsView } from "@/components/views/approvals-view";
import type { AgentRun } from "@/lib/types";

export type ScoutView =
  | "chat"
  | "flows"
  | "live"
  | "recorder"
  | "connectors"
  | "approvals"
  | "history";

const NAV: { id: ScoutView; label: string; icon: string }[] = [
  { id: "chat", label: "Ask Agent", icon: "chat" },
  { id: "flows", label: "Flows & Suites", icon: "flows" },
  { id: "live", label: "Live Runs", icon: "live" },
  { id: "recorder", label: "Recorder", icon: "recorder" },
  { id: "connectors", label: "Connectors", icon: "conn" },
  { id: "approvals", label: "Approvals", icon: "appr" },
  { id: "history", label: "History", icon: "hist" },
];

function NavIcon({ name }: { name: string }) {
  const p = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (name === "chat")
    return (
      <svg {...p}>
        <path d="M8 10h8M8 14h5M21 12c0 4.4-4 8-9 8-1.4 0-2.7-.3-3.9-.8L3 20l1-4.2C3.4 14.5 3 13.3 3 12c0-4.4 4-8 9-8s9 3.6 9 8z" />
      </svg>
    );
  if (name === "recorder")
    return (
      <svg {...p}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 9l3 3-3 3M13 15h4" />
      </svg>
    );
  if (name === "live")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

export function ScoutApp() {
  const [view, setView] = useState<ScoutView>("chat");
  const [liveRun, setLiveRun] = useState<AgentRun | null>(null);
  const [showApprovals, setShowApprovals] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const refreshApprovals = useCallback(async () => {
    try {
      const res = await fetch("/api/approval");
      const json = await res.json();
      setPendingApprovals((json.flows || []).length);
    } catch {
      setPendingApprovals(0);
    }
  }, []);

  useEffect(() => {
    refreshApprovals();
  }, [refreshApprovals]);

  const onRunStarted = (run: AgentRun) => {
    setLiveRun(run);
    setView("live");
  };

  let content: ReactNode;
  switch (view) {
    case "chat":
      content = <ChatAgentView onRunStarted={onRunStarted} onOpenLive={() => setView("live")} />;
      break;
    case "flows":
      content = <FlowsView onRunFlow={() => setView("chat")} />;
      break;
    case "live":
      content = <LiveRunView run={liveRun} onRunUpdate={setLiveRun} />;
      break;
    case "recorder":
      content = <RecorderView />;
      break;
    case "connectors":
      content = <ConnectorsView />;
      break;
    case "approvals":
      content = <ApprovalsView />;
      break;
    case "history":
      content = <HistoryView />;
      break;
    default:
      content = null;
  }

  return (
    <div className="scout-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 12l5 5L20 6" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="brand-name">Scout</div>
            <div className="brand-sub">QA Agent Console</div>
          </div>
        </div>

        <nav className="nav-group">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => setView(item.id)}
            >
              <NavIcon name={item.icon} />
              {item.label}
              {item.id === "approvals" && pendingApprovals > 0 && <span className="dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="credit-bar">
            <div className="credit-label">Agent runtime · local orchestrator</div>
            <div className="credit-track">
              <div className="credit-fill" style={{ width: "62%" }} />
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className={`tab ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}>
            Overview
          </div>
          {liveRun && (liveRun.status === "running" || liveRun.status === "queued") && (
            <div className={`tab ${view === "live" ? "active" : ""}`} onClick={() => setView("live")}>
              <span className="status-chip running" /> Live Run
            </div>
          )}
          <div className="topbar-spacer" />
          <div className="topbar-icons">
            <button type="button" className="icon-btn" onClick={() => setShowApprovals((v) => !v)} aria-label="Approvals">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9zM13.7 21a2 2 0 01-3.4 0" />
              </svg>
              {pendingApprovals > 0 && <span className="badge-dot" />}
            </button>
            <div className="avatar" />
          </div>
          {showApprovals && (
            <div className="approvals-pop open">
              <ApprovalsView compact onClose={() => setShowApprovals(false)} />
            </div>
          )}
        </header>

        <div className={`view active view-${view}`}>{content}</div>
      </div>
    </div>
  );
}
