"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRun } from "@/lib/types";
import { ReportPreview } from "@/components/report-preview";

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
  runId?: string;
  run?: AgentRun;
  actions?: { label: string; action: string; payload?: string }[];
  attachment?: { title: string; pillId?: string };
};

function uid() {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function listSanityFlows(): Promise<string> {
  const res = await fetch("/api/flows?tag=sanity");
  const json = await res.json();
  const lines = (json.flows || []).map(
    (f: { id: string; name: string }) => `- **${f.id}** — ${f.name}`
  );
  return `Here are the **${lines.length} sanity-ready flows**:\n\n${lines.join("\n")}\n\nSay *run morning sanity* or *test payment flow* to execute.`;
}

async function listKnowledge(): Promise<string> {
  const res = await fetch("/api/knowledge");
  const json = await res.json();
  const pills = json.knowledge || [];
  if (!pills.length) return "No knowledge documents attached yet. Paste requirements or DB notes in chat — I'll ingest them for the next run.";
  return pills
    .slice(0, 12)
    .map((p: { title: string; format: string; id: string }) => `- **${p.title}** (${p.format}) · \`${p.id}\``)
    .join("\n");
}

function detectLocalIntent(text: string): "sanity_list" | "knowledge_list" | null {
  const t = text.toLowerCase();
  if (/list.*sanity|sanity flows|show.*sanity|what.*sanity/.test(t)) return "sanity_list";
  if (/list.*doc|knowledge|from the db|fetch.*doc|attached.*doc/.test(t)) return "knowledge_list";
  return null;
}

export function ChatAgentView({
  onRunStarted,
  onOpenLive,
}: {
  onRunStarted: (run: AgentRun) => void;
  onOpenLive: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: uid(),
      role: "assistant",
      at: new Date().toISOString(),
      text:
        "I'm Scout — your QA agent. Ask me to **run sanity**, **test payment flows**, **list flows**, attach a new feature description, or **discover** site changes. Tests open in a visible Chrome window on your machine.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const pollRun = useCallback(
    (runId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/runs/${runId}`);
          if (!res.ok) return;
          const { run } = (await res.json()) as { run: AgentRun };
          onRunStarted(run);
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.runId === runId);
            const traceSummary =
              run.traces.length > 0
                ? run.traces
                    .slice(-4)
                    .map((t) => `• ${t.message}`)
                    .join("\n")
                : "Working…";
            const body =
              run.status === "running" || run.status === "queued"
                ? `**Running** — ${run.goal}\n\n${traceSummary}\n\n[Watch live run →](#live)`
                : run.report?.markdown
                  ? `**${run.conclusion || run.status}**\n\n${run.report.summary}\n\n---\n\n${run.report.markdown.slice(0, 4000)}`
                  : `**${run.conclusion || run.status}** — ${run.goal}`;

            const msg: ChatMsg = {
              id: idx >= 0 ? prev[idx].id : uid(),
              role: "assistant",
              at: new Date().toISOString(),
              text: body,
              runId,
              run,
              actions:
                run.status === "completed" && run.report
                  ? [
                      { label: "Open live view", action: "live" },
                      { label: "Export PDF", action: "export", payload: "pdf" },
                      { label: "Export DOCX", action: "export", payload: "docx" },
                    ]
                  : run.status === "running"
                    ? [{ label: "Watch live browser", action: "live" }]
                    : undefined,
            };
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg;
              return next;
            }
            return [...prev, msg];
          });

          if (run.status !== "running" && run.status !== "queued") {
            if (pollRef.current) clearInterval(pollRef.current);
            setBusy(false);
            setActiveRunId(null);
          }
        } catch {
          /* retry */
        }
      }, 600);
    },
    [onRunStarted]
  );

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function ingestAttachment(text: string, title: string): Promise<string | undefined> {
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: text, format: "markdown", tags: ["chat-attach"] }),
    });
    const json = await res.json();
    return json.pill?.id as string | undefined;
  }

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const userMsg: ChatMsg = { id: uid(), role: "user", text, at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    const local = detectLocalIntent(text);
    if (local === "sanity_list") {
      const reply = await listSanityFlows();
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", text: reply, at: new Date().toISOString() },
      ]);
      setBusy(false);
      return;
    }
    if (local === "knowledge_list") {
      const reply = await listKnowledge();
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", text: reply, at: new Date().toISOString() },
      ]);
      setBusy(false);
      return;
    }

    let knowledgeIds: string[] = [];
    if (text.length > 400 && /new flow|feature|scenario|test case/i.test(text)) {
      const pillId = await ingestAttachment(text, "Chat — new flow requirement");
      if (pillId) knowledgeIds = [pillId];
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "system",
          text: "Attached your requirement to the knowledge base. Building automation draft…",
          at: new Date().toISOString(),
        },
      ]);
    }

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text, headed: true, notify: false, knowledgeIds }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            text: json.error || "Another run is in progress.",
            at: new Date().toISOString(),
          },
        ]);
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(json.error || "Run failed");

      const run = json.run as AgentRun;
      setActiveRunId(run.id);
      onRunStarted(run);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: `Starting **${run.type}** run — opening Chrome on your machine.\n\nGoal: ${text}\n\nI'll stream progress here and in **Live Runs**.`,
          at: new Date().toISOString(),
          runId: run.id,
          run,
          actions: [{ label: "Watch live browser", action: "live" }],
        },
      ]);
      pollRun(run.id);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: `Could not start agent: ${e instanceof Error ? e.message : String(e)}\n\nEnsure \`python scripts/local_agent_server.py\` is running on port 43124.`,
          at: new Date().toISOString(),
        },
      ]);
      setBusy(false);
    }
  }

  function handleAction(action: string, run?: AgentRun, payload?: string) {
    if (action === "live") onOpenLive();
    if (action === "export" && run?.id && payload) {
      window.open(`/api/export?runId=${run.id}&format=${payload}`, "_blank");
    }
    if (action === "approve") {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "system",
          text: "Flow marked for SME review — see Approvals in the sidebar.",
          at: new Date().toISOString(),
        },
      ]);
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="chat-msg-meta">{m.role === "user" ? "You" : m.role === "system" ? "System" : "Scout"}</div>
            <div className="chat-msg-body">
              {m.run?.report?.markdown && m.run.status === "completed" ? (
                <ReportPreview markdown={m.run.report.markdown.slice(0, 6000)} evidence={[]} />
              ) : (
                <div className="chat-md" style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              )}
              {m.actions && (
                <div className="chat-actions">
                  {m.actions.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      className="chat-cta"
                      onClick={() => handleAction(a.action, m.run, a.payload)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && activeRunId && (
          <div className="chat-msg assistant">
            <div className="chat-msg-meta">Scout</div>
            <div className="chat-msg-body chat-typing">Agent running in visible Chrome…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Scout — run sanity, list flows, test payment, paste new flow requirements…"
          rows={2}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage();
            }
          }}
        />
        <button type="button" className="chat-send" disabled={busy || !input.trim()} onClick={() => void sendMessage()}>
          Send
        </button>
      </div>

      <div className="chip-row">
        {["Run morning sanity", "List sanity flows", "Test payment flow", "Run full regression"].map((chip) => (
          <button key={chip} type="button" className="chip" disabled={busy} onClick={() => void sendMessage(chip)}>
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
