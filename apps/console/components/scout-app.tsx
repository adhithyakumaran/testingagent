"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  GitBranch,
  MessageSquare,
  Plug,
  Radio,
  Video,
} from "lucide-react";
import { ChatAgentView } from "@/components/views/chat-agent-view";
import { LiveRunView } from "@/components/views/live-run-view";
import { RecorderView } from "@/components/views/recorder-view";
import { HistoryView } from "@/components/views/history-view";
import { FlowsView } from "@/components/views/flows-view";
import { ConnectorsView } from "@/components/views/connectors-view";
import { ApprovalsView } from "@/components/views/approvals-view";
import { ScoutMark } from "@/components/scout-mark";
import type { AgentRun } from "@/lib/types";

export type ScoutView =
  | "chat"
  | "flows"
  | "live"
  | "recorder"
  | "connectors"
  | "approvals"
  | "history";

const NAV: { id: ScoutView; label: string; icon: ReactNode }[] = [
  { id: "chat", label: "Ask Agent", icon: <MessageSquare size={16} /> },
  { id: "flows", label: "Flows & Suites", icon: <GitBranch size={16} /> },
  { id: "live", label: "Live Runs", icon: <Radio size={16} /> },
  { id: "recorder", label: "Recorder", icon: <Video size={16} /> },
  { id: "connectors", label: "Connectors", icon: <Plug size={16} /> },
  { id: "approvals", label: "Approvals", icon: <CheckCircle2 size={16} /> },
  { id: "history", label: "History", icon: <Clock3 size={16} /> },
];

function ViewPane({ active, name, children }: { active: boolean; name: ScoutView; children: ReactNode }) {
  return (
    <div className={`view view-${name}${active ? "" : " view-hidden"}`} aria-hidden={!active}>
      {children}
    </div>
  );
}

type OrchestratorHealth = {
  ok?: boolean;
  primary_ready_flows?: number;
  executor?: string;
  llm_enabled?: boolean;
};

function OrchestratorStatus() {
  const [health, setHealth] = useState<OrchestratorHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/orchestrator", { cache: "no-store" });
        const json = (await res.json()) as OrchestratorHealth;
        if (!cancelled) setHealth(json);
      } catch {
        if (!cancelled) setHealth({ ok: false });
      }
    };
    void poll();
    const id = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const online = health?.ok === true;
  const flows = health?.primary_ready_flows;

  return (
    <div className="orchestrator-status">
      <p className="orchestrator-status-label">Orchestrator</p>
      <div className="orchestrator-status-row">
        <span className={`orchestrator-dot ${online ? "online" : "offline"}`} />
        {online ? "Connected" : "Offline"}
      </div>
      <p className="orchestrator-status-meta">
        {online
          ? `${flows ?? "—"} ready flows · ${health?.executor || "playwright"}${health?.llm_enabled ? " · LLM" : ""}`
          : "Start python scripts/local_agent_server.py"}
      </p>
    </div>
  );
}

export function ScoutApp() {
  const [view, setView] = useState<ScoutView>("chat");
  const [liveRun, setLiveRun] = useState<AgentRun | null>(null);
  const [showApprovals, setShowApprovals] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [pendingGoal, setPendingGoal] = useState<string | null>(null);

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
  };

  return (
    <div className="scout-app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <ScoutMark size={18} />
          </div>
          <div className="sidebar-brand-text">
            <p className="sidebar-brand-name">Scout</p>
            <p className="sidebar-brand-sub">QA Agent Console</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              <span className="nav-item-label">{item.label}</span>
              {item.id === "approvals" && pendingApprovals > 0 && (
                <span className="nav-badge">{pendingApprovals}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <OrchestratorStatus />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-tabs">
            <button
              type="button"
              className={`topbar-tab ${view === "chat" ? "active" : ""}`}
              onClick={() => setView("chat")}
            >
              Overview
            </button>
            {liveRun && (liveRun.status === "running" || liveRun.status === "queued") && (
              <button
                type="button"
                className={`topbar-tab ${view === "live" ? "active" : ""}`}
                onClick={() => setView("live")}
              >
                <span className="status-chip running" />
                Live Run
              </button>
            )}
          </div>

          <div className="topbar-actions">
            <div className="approvals-popover">
              <button
                type="button"
                className={`icon-btn ${showApprovals ? "active" : ""}`}
                onClick={() => setShowApprovals((v) => !v)}
                aria-label="Approvals"
              >
                <CheckCircle2 size={16} />
                {pendingApprovals > 0 && <span className="icon-btn-badge">{pendingApprovals}</span>}
              </button>
              {showApprovals && (
                <div className="approvals-popover-panel">
                  <ApprovalsView compact onClose={() => setShowApprovals(false)} />
                </div>
              )}
            </div>
            <div className="topbar-avatar" aria-hidden>
              <ScoutMark size={14} />
            </div>
          </div>
        </header>

        <div className="view-stack">
          <ViewPane active={view === "chat"} name="chat">
            <ChatAgentView
              onRunStarted={onRunStarted}
              onOpenLive={() => setView("live")}
              pendingGoal={pendingGoal}
              onPendingGoalHandled={() => setPendingGoal(null)}
            />
          </ViewPane>
          <ViewPane active={view === "flows"} name="flows">
            <FlowsView
              onRunFlow={(goal) => {
                setPendingGoal(goal);
                setView("chat");
              }}
            />
          </ViewPane>
          <ViewPane active={view === "live"} name="live">
            <LiveRunView run={liveRun} onRunUpdate={setLiveRun} />
          </ViewPane>
          <ViewPane active={view === "recorder"} name="recorder">
            <RecorderView />
          </ViewPane>
          <ViewPane active={view === "connectors"} name="connectors">
            <ConnectorsView />
          </ViewPane>
          <ViewPane active={view === "approvals"} name="approvals">
            <ApprovalsView />
          </ViewPane>
          <ViewPane active={view === "history"} name="history">
            <HistoryView />
          </ViewPane>
        </div>
      </div>
    </div>
  );
}
