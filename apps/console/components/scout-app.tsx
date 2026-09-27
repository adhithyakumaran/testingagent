"use client";

import { useCallback, useState } from "react";
import {
  Activity,
  CheckSquare,
  ClipboardList,
  History,
  LayoutDashboard,
  Menu,
  Radio,
  Settings2,
  Stethoscope,
  Video,
  Workflow,
  X,
} from "lucide-react";
import { AskAgentView } from "@/components/views/ask-agent-view";
import { ApprovalsView } from "@/components/views/approvals-view";
import { ConnectorsView } from "@/components/views/connectors-view";
import { EvidenceView } from "@/components/views/evidence-view";
import { FlowsView } from "@/components/views/flows-view";
import { HealingView } from "@/components/views/healing-view";
import { HistoryView } from "@/components/views/history-view";
import { LiveRunsView } from "@/components/views/live-runs-view";
import { RecorderView } from "@/components/views/recorder-view";
import { AgentChatFab } from "@/components/agent-chat-panel";
import { useOrchestratorStatus } from "@/lib/use-orchestrator";
import { useLatestRunSync } from "@/lib/use-run-sync";
import { submitAgentRun } from "@/lib/run-submit-client";
import type { AgentRun } from "@/lib/types";

export type ScoutView =
  | "ask"
  | "runs"
  | "flows"
  | "evidence"
  | "healing"
  | "recorder"
  | "approvals"
  | "history"
  | "connectors";

const NAV: { group: string; items: { id: ScoutView; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: "Operate",
    items: [
      { id: "ask", label: "Ask Agent", icon: <LayoutDashboard size={18} /> },
      { id: "runs", label: "Runs", icon: <Activity size={18} /> },
      { id: "flows", label: "Flows", icon: <Workflow size={18} /> },
    ],
  },
  {
    group: "Investigate",
    items: [
      { id: "evidence", label: "Evidence", icon: <ClipboardList size={18} /> },
      { id: "healing", label: "Healing", icon: <Stethoscope size={18} /> },
      { id: "recorder", label: "Recorder", icon: <Video size={18} /> },
    ],
  },
  {
    group: "Govern",
    items: [
      { id: "approvals", label: "Approvals", icon: <CheckSquare size={18} /> },
      { id: "history", label: "History", icon: <History size={18} /> },
    ],
  },
  {
    group: "Configure",
    items: [{ id: "connectors", label: "Connectors", icon: <Settings2 size={18} /> }],
  },
];

export function ScoutApp() {
  const [view, setView] = useState<ScoutView>("ask");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prompt, setPrompt] = useState("Check login and product search on Endless Aisle UAT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [chatFlowId, setChatFlowId] = useState<string | null>(null);
  const [chatRunId, setChatRunId] = useState<string | null>(null);
  const [notifyChannels] = useState(["email", "whatsapp"]);
  const { status: orchestrator } = useOrchestratorStatus();

  useLatestRunSync(activeRun, setActiveRun);

  const runAgent = useCallback(
    async (goal: string, type: "adhoc" | "sanity" = "adhoc") => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const outcome = await submitAgentRun(fetch, { goal, type, channels: notifyChannels });
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        setActiveRun(outcome.run);
        setView("runs");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, notifyChannels]
  );

  function renderView() {
    switch (view) {
      case "ask":
        return (
          <AskAgentView
            orchestrator={orchestrator}
            busy={busy}
            error={error}
            prompt={prompt}
            setPrompt={setPrompt}
            onRun={runAgent}
            activeRun={activeRun}
            onViewRun={() => setView("runs")}
          />
        );
      case "runs":
        return (
          <LiveRunsView
            runId={chatRunId || activeRun?.id}
            initialRun={activeRun}
            onRunUpdated={setActiveRun}
          />
        );
      case "flows":
        return (
          <FlowsView
            initialFlowId={chatFlowId}
            onRunFlow={(goal) => runAgent(goal, "adhoc")}
          />
        );
      case "evidence":
        return <EvidenceView run={activeRun} />;
      case "healing":
        return <HealingView />;
      case "recorder":
        return <RecorderView />;
      case "approvals":
        return <ApprovalsView />;
      case "history":
        return <HistoryView />;
      case "connectors":
        return <ConnectorsView />;
      default:
        return null;
    }
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <aside className={`app-sidebar ${sidebarOpen ? "app-sidebar--open" : ""}`} aria-label="Primary">
        <div className="app-sidebar__brand">
          <div className="app-logo" aria-hidden>
            <Radio size={18} />
          </div>
          <div>
            <strong>ScoutAI</strong>
            <span>Enterprise QA Agent</span>
          </div>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="app-nav">
          {NAV.map((section) => (
            <div key={section.group} className="app-nav__group">
              <span className="app-nav__label">{section.group}</span>
              <ul>
                {section.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={view === item.id ? "nav-item nav-item--active" : "nav-item"}
                      onClick={() => {
                        setView(item.id);
                        setSidebarOpen(false);
                      }}
                      aria-current={view === item.id ? "page" : undefined}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      {item.id === "approvals" && orchestrator?.pendingApprovals ? (
                        <span className="nav-badge">{orchestrator.pendingApprovals}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="app-sidebar__foot">
          <span className="app-sidebar__foot-label">Environment</span>
          <span className="app-sidebar__foot-value">{orchestrator?.environment || "UAT"}</span>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="icon-button mobile-only"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>

          <div className="topbar-title">
            <span>ScoutAI</span>
            <span className="topbar-env">{orchestrator?.environment || "UAT"}</span>
          </div>

          <div className="topbar-status" role="status" aria-live="polite">
            <span className={orchestrator?.connected ? "dot dot--ok" : "dot dot--bad"} aria-hidden />
            <span>{orchestrator?.connected ? "Connected" : "Offline"}</span>
            <span className="topbar-status__sep" aria-hidden>
              ·
            </span>
            <span>{orchestrator?.flowCounts?.executable ?? "—"} executable</span>
            <span className="topbar-status__sep" aria-hidden>
              ·
            </span>
            <span>{orchestrator?.flowCounts?.smeReady ?? "—"} SME-ready</span>
            {orchestrator?.pendingApprovals ? (
              <>
                <span className="topbar-status__sep" aria-hidden>
                  ·
                </span>
                <button type="button" className="topbar-link" onClick={() => setView("approvals")}>
                  {orchestrator.pendingApprovals} pending approval
                </button>
              </>
            ) : (
              <>
                <span className="topbar-status__sep" aria-hidden>
                  ·
                </span>
                <span className="topbar-status__approved">
                  {orchestrator?.connected ? "Approved" : "Unavailable"}
                </span>
              </>
            )}
          </div>
        </header>

        <main id="main-content" className="app-content">
          {renderView()}
        </main>
      </div>

      <AgentChatFab
        onNavigate={({ view, flowId, runId }) => {
          setView(view);
          if (flowId) setChatFlowId(flowId);
          if (runId) {
            setChatRunId(runId);
            fetch(`/api/runs/${runId}`)
              .then((r) => r.json())
              .then((json) => {
                if (json.run) setActiveRun(json.run as AgentRun);
              })
              .catch(() => undefined);
          }
        }}
      />
    </div>
  );
}
