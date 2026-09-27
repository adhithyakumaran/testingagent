import { promises as fs } from "fs";
import path from "path";
import type { AppState, HistoryItem } from "@/lib/types";
import { MODEL_OPTIONS } from "@/lib/types";
import { TEST_REPORT_EMAIL, TEST_REPORT_WHATSAPP } from "@/lib/channel-defaults";
import { atomicWriteJson, readTextWithRetry, withFileLock } from "@/lib/fs-atomic";
import { uid } from "@/lib/utils";
import {
  agentProbeFromJson,
  hasActiveRun,
  isActiveRunStatus,
  reconcileActiveRuns,
  type AgentRunProbe,
} from "@/lib/active-run-lock";
import { fetchInternalAgent } from "@/lib/internal-agent";

export { hasActiveRun };

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const STATE_LOCK = path.join(DATA_DIR, ".locks", "console-state.lock");

const defaultState = (): AppState => ({
  runs: [],
  knowledge: [],
  history: [
    {
      id: uid("hist"),
      at: new Date().toISOString(),
      action: "Command center online",
      actor: "system",
      meta: { note: "Enterprise QA console ready for demo" },
    },
  ],
  schedule: {
    enabled: true,
    timeLocal: "08:00",
    timezone: "Asia/Kolkata",
    goal: "sanity check endless aisle login and home modules",
    channels: ["email", "whatsapp"],
  },
  channels: {
    email: [TEST_REPORT_EMAIL],
    teamsWebhook: process.env.TEAMS_WEBHOOK_URL || "",
    whatsapp: TEST_REPORT_WHATSAPP,
    slackWebhook: "",
  },
  selectedModel: MODEL_OPTIONS.find((m) => m.id === "groq/openai/gpt-oss-120b")?.id || "groq/openai/gpt-oss-120b",
  usageTotal: { tokensIn: 0, tokensOut: 0, runs: 0 },
});

function migrate(state: AppState): AppState {
  const placeholder = "qa-lead@client.example";
  state.channels = {
    email: [TEST_REPORT_EMAIL],
    teamsWebhook: state.channels?.teamsWebhook || process.env.TEAMS_WEBHOOK_URL || "",
    whatsapp: TEST_REPORT_WHATSAPP,
    slackWebhook: state.channels?.slackWebhook || "",
    ...((state.channels?.email && !state.channels.email.includes(placeholder)
      ? { email: state.channels.email }
      : {}) as Partial<AppState["channels"]>),
    ...(state.channels?.whatsapp && state.channels.whatsapp.replace(/\D/g, "").length >= 10
      ? { whatsapp: state.channels.whatsapp }
      : {}),
  };
  if (!state.channels.email?.length || state.channels.email.includes(placeholder)) {
    state.channels.email = [TEST_REPORT_EMAIL];
  }
  if (!state.channels.whatsapp || state.channels.whatsapp.replace(/\D/g, "").length < 10) {
    state.channels.whatsapp = TEST_REPORT_WHATSAPP;
  }
  if (!state.schedule.channels?.includes("whatsapp")) {
    state.schedule.channels = Array.from(new Set([...(state.schedule.channels || []), "email", "whatsapp"]));
  }
  return state;
}

export async function readState(): Promise<AppState> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = JSON.parse(await readTextWithRetry(STATE_FILE)) as Partial<AppState>;
    const base = defaultState();
    const merged: AppState = {
      ...base,
      ...raw,
      channels: { ...base.channels, ...(raw.channels || {}) },
      schedule: { ...base.schedule, ...(raw.schedule || {}) },
      usageTotal: { ...base.usageTotal, ...(raw.usageTotal || {}) },
      runs: raw.runs || [],
      knowledge: raw.knowledge || [],
      history: raw.history || base.history,
    };
    return migrate(merged);
  } catch {
    const s = defaultState();
    await atomicWriteJson(STATE_FILE, s);
    return s;
  }
}

export async function writeState(state: AppState): Promise<void> {
  const backoffMs = [0, 25, 75, 150, 300];
  let lastErr: unknown;
  for (const wait of backoffMs) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      await atomicWriteJson(STATE_FILE, state);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function mutateState(fn: (s: AppState) => void | Promise<void>): Promise<AppState> {
  return withFileLock(STATE_LOCK, async () => {
    const state = await readState();
    await fn(state);
    await writeState(state);
    return state;
  });
}

export function pushHistory(
  state: AppState,
  action: string,
  actor = "client",
  meta?: Record<string, unknown>
) {
  const item: HistoryItem = {
    id: uid("hist"),
    at: new Date().toISOString(),
    action,
    actor,
    meta,
  };
  state.history = [item, ...state.history].slice(0, 200);
  return item;
}

async function probeAgentRun(runId: string): Promise<AgentRunProbe> {
  try {
    const res = await fetchInternalAgent(`/agent/${encodeURIComponent(runId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return agentProbeFromJson(res.status, body);
  } catch {
    return { kind: "unreachable" };
  }
}

/** Reconcile orphaned/stale active runs before enforcing the single-run command lock. */
export async function reconcileStoredRunLocks(): Promise<AppState> {
  return mutateState(async (state) => {
    const probes = new Map<string, AgentRunProbe>();
    for (const run of state.runs) {
      if (isActiveRunStatus(run.status)) {
        probes.set(run.id, await probeAgentRun(run.id));
      }
    }
    const { changed, releasedRunIds } = reconcileActiveRuns(state, (id) => probes.get(id) || { kind: "unreachable" });
    if (changed) {
      pushHistory(state, "Released stale command lock", "system", { releasedRunIds });
    }
  });
}
