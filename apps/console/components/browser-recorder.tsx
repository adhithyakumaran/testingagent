"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, MousePointer2, Settings2, Square, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/input";

type RecorderConfig = {
  console: boolean;
  network: boolean;
  interactions: boolean;
  dom_snapshots: boolean;
  video: boolean;
  session_replay: boolean;
};

const DEFAULT_CONFIG: RecorderConfig = {
  console: false,
  network: false,
  interactions: true,
  dom_snapshots: true,
  video: false,
  session_replay: false,
};

type RecorderEvent = {
  id?: number;
  kind: string;
  at?: string;
  action?: string;
  selector?: string;
  url?: string;
  title?: string;
  element?: {
    tag?: string;
    text?: string;
    attributes?: Record<string, string>;
    classList?: string[];
    locators?: Record<string, string>;
  };
  locators?: Record<string, string>;
  element_file?: string;
  dom_file?: string;
  reason?: string;
  status?: string;
  events?: number;
};

function formatEvent(ev: RecorderEvent): string {
  if (ev.kind === "interaction") {
    const locs = ev.element?.locators || ev.locators || {};
    const primary = locs.id || locs.apexItem || locs.name || ev.selector || ev.element?.tag || "element";
    const tag = ev.element?.tag ? `<${ev.element.tag}>` : "";
    const text = ev.element?.text ? ` "${ev.element.text.slice(0, 48)}"` : "";
    return `${ev.action || "click"} ${tag}${text} → ${primary}`;
  }
  if (ev.kind === "navigation") return `nav → ${ev.title || ev.url || "page"}`;
  if (ev.kind === "dom_snapshot") return `DOM saved ${ev.dom_file || ""} (${ev.reason || "snapshot"})`;
  if (ev.kind === "session_start") return `session started @ ${ev.url || ""}`;
  if (ev.kind === "session_end") return `session ${ev.status || "ended"} — ${ev.events ?? 0} events`;
  if (ev.kind === "connected") return "live stream connected";
  return ev.kind;
}

function locatorTags(ev: RecorderEvent): string[] {
  const locs = ev.element?.locators || ev.locators || {};
  return Object.entries(locs)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`);
}

export function BrowserRecorderPanel() {
  const [config, setConfig] = useState<RecorderConfig>(DEFAULT_CONFIG);
  const [sessionId] = useState(() => `scout-${Date.now().toString(36)}`);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<RecorderEvent[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/recorder?sessionId=${sessionId}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setStatus(String(json.status?.status || "idle"));
      }
    } catch {
      setStatus("offline");
    }
  }, [sessionId]);

  useEffect(() => {
    refreshStatus();
    return () => {
      sourceRef.current?.close();
    };
  }, [refreshStatus]);

  async function saveConfig(next: RecorderConfig) {
    setConfig(next);
    await fetch("/api/recorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, config: next }),
    });
  }

  function connectStream() {
    sourceRef.current?.close();
    const src = new EventSource(`/api/recorder/stream?sessionId=${encodeURIComponent(sessionId)}`);
    sourceRef.current = src;

    src.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as RecorderEvent;
        if (ev.kind === "session_end") {
          setRecording(false);
          setStatus(String(ev.status || "completed"));
          setMessage(
            `Captured ${ev.events ?? liveEvents.length} events — data/discovery-kb/recordings/sessions/${sessionId}`
          );
          src.close();
          sourceRef.current = null;
        }
        setLiveEvents((prev) => [...prev, ev].slice(-80));
        if (ev.kind === "interaction" || ev.kind === "navigation") {
          setStatus("recording");
        }
      } catch {
        /* ignore malformed chunk */
      }
    };

    src.onerror = () => {
      if (!recording) {
        src.close();
        sourceRef.current = null;
      }
    };
  }

  async function startSession() {
    setMessage(null);
    setLiveEvents([]);
    setRecording(true);
    setStatus("starting");
    connectStream();

    try {
      const res = await fetch("/api/recorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action: "start", config, maxSeconds: 3600 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Recorder failed to start");
      setStatus("recording");
      setMessage("Live capture active — interact in the browser window. Click Stop when done.");
    } catch (e) {
      setRecording(false);
      sourceRef.current?.close();
      setMessage(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function stopSession() {
    try {
      await fetch("/api/recorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action: "stop" }),
      });
      setMessage("Stopping session…");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="scout-panel scout-recorder">
      <div className="scout-panel-head">
        <Circle size={14} className={`scout-rec-dot ${recording ? "live" : ""}`} />
        <span>Browser Recorder</span>
        <Badge tone={recording ? "warn" : "neutral"}>{status}</Badge>
        <Settings2 size={14} className="scout-muted-icon" />
      </div>

      <div className="scout-rec-body">
        <div className="scout-rec-actions">
          <Button
            className="scout-btn-emerald scout-rec-start"
            disabled={recording}
            onClick={startSession}
          >
            <Circle size={12} fill="currentColor" />
            Start live capture
          </Button>
          <Button className="scout-btn-stop scout-rec-stop" disabled={!recording} onClick={stopSession}>
            <Square size={12} fill="currentColor" />
            Stop
          </Button>
        </div>

        <p className="scout-rec-section">Suite authoring capture</p>
        <ul className="scout-rec-toggles">
          <li>
            <div className="scout-rec-toggle-meta">
              <MousePointer2 size={16} />
              <div>
                <strong>Interactions + locators</strong>
                <span>Clicks, inputs — id, name, role, APEX item, text fallbacks</span>
              </div>
            </div>
            <button
              type="button"
              className={`scout-switch ${config.interactions ? "on" : ""}`}
              aria-pressed={config.interactions}
              onClick={() => void saveConfig({ ...config, interactions: !config.interactions })}
            >
              <span />
            </button>
          </li>
          <li>
            <div className="scout-rec-toggle-meta">
              <Tag size={16} />
              <div>
                <strong>DOM elements on action</strong>
                <span>outerHTML + element JSON saved per click/navigation</span>
              </div>
            </div>
            <button
              type="button"
              className={`scout-switch ${config.dom_snapshots ? "on" : ""}`}
              aria-pressed={config.dom_snapshots}
              onClick={() => void saveConfig({ ...config, dom_snapshots: !config.dom_snapshots })}
            >
              <span />
            </button>
          </li>
        </ul>

        <p className="scout-rec-note">
          Real-time SSE stream — locators, tags, and DOM fragments feed future Playwright suite generation.
          Output: <code>data/discovery-kb/recordings/sessions/{sessionId}/</code>
        </p>
        {message && <p className="scout-rec-msg">{message}</p>}

        <div className="scout-live-feed">
          <p className="scout-rec-section">
            Live capture {recording ? "● streaming" : ""} ({liveEvents.length})
          </p>
          {liveEvents.length === 0 ? (
            <p className="scout-live-empty">Start capture — events appear here instantly as you click in the browser.</p>
          ) : (
            <ul>
              {[...liveEvents].reverse().slice(0, 16).map((ev, i) => (
                <li key={`${ev.id ?? ev.at}-${i}`}>
                  <div className="scout-live-line">
                    <strong>{ev.kind}</strong>
                    <span>{formatEvent(ev)}</span>
                  </div>
                  {ev.kind === "interaction" && locatorTags(ev).length > 0 && (
                    <div className="scout-live-locators">
                      {locatorTags(ev).map((tag) => (
                        <code key={tag}>{tag}</code>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
