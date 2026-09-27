import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_EXECUTION_STALE_MS,
  QUEUED_STALE_MS,
  hasActiveRun,
  reconcileActiveRuns,
  type AgentRunProbe,
} from "./active-run-lock.ts";
import type { AgentRun, AppState } from "./types.ts";

function run(partial: Partial<AgentRun> & Pick<AgentRun, "id" | "status">): AgentRun {
  const now = "2026-01-01T12:00:00.000Z";
  return {
    createdAt: now,
    updatedAt: now,
    type: "adhoc",
    goal: "test goal",
    model: "disabled",
    llmEnabled: false,
    traces: [],
    usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
    ...partial,
  };
}

function stateWith(...runs: AgentRun[]): AppState {
  return {
    runs,
    knowledge: [],
    history: [],
    schedule: {
      enabled: false,
      timeLocal: "08:00",
      timezone: "UTC",
      goal: "",
      channels: [],
    },
    channels: { email: [], teamsWebhook: "", whatsapp: "", slackWebhook: "" },
    selectedModel: "disabled",
    usageTotal: { tokensIn: 0, tokensOut: 0, runs: 0 },
  };
}

const T0 = Date.parse("2026-01-01T12:00:00.000Z");

test("genuinely active run blocks hasActiveRun", () => {
  const state = stateWith(run({ id: "r1", status: "running" }));
  assert.equal(hasActiveRun(state), true);
});

test("completed and failed runs do not hold the command lock", () => {
  assert.equal(hasActiveRun(stateWith(run({ id: "r1", status: "completed" }))), false);
  assert.equal(hasActiveRun(stateWith(run({ id: "r2", status: "failed" }))), false);
});

test("orphaned queued run is released when agent has no record", () => {
  const state = stateWith(
    run({
      id: "r-orphan",
      status: "queued",
      createdAt: new Date(T0 - 10_000).toISOString(),
      updatedAt: new Date(T0 - 10_000).toISOString(),
    })
  );
  const probe = (): AgentRunProbe => ({ kind: "missing" });
  const { changed, releasedRunIds } = reconcileActiveRuns(state, probe, () => T0);
  assert.equal(changed, true);
  assert.deepEqual(releasedRunIds, ["r-orphan"]);
  assert.equal(state.runs[0].status, "failed");
  assert.equal(hasActiveRun(state), false);
});

test("stale queued run is released after QUEUED_STALE_MS even if agent is unreachable", () => {
  const state = stateWith(
    run({
      id: "r-stale-q",
      status: "queued",
      createdAt: new Date(T0 - QUEUED_STALE_MS - 1).toISOString(),
      updatedAt: new Date(T0 - QUEUED_STALE_MS - 1).toISOString(),
    })
  );
  const { changed } = reconcileActiveRuns(state, () => ({ kind: "unreachable" }), () => T0);
  assert.equal(changed, true);
  assert.equal(state.runs[0].reasonCode, "console.run_stale_queued");
});

test("agent terminal status sync releases active console lock", () => {
  const state = stateWith(run({ id: "r-done", status: "running" }));
  const probe = (): AgentRunProbe => ({
    kind: "terminal",
    status: "COMPLETED",
    conclusion: "PASS",
  });
  const { changed } = reconcileActiveRuns(state, probe, () => T0);
  assert.equal(changed, true);
  assert.equal(state.runs[0].status, "completed");
  assert.equal(hasActiveRun(state), false);
});

test("active agent execution keeps the command lock", () => {
  const state = stateWith(
    run({
      id: "r-live",
      status: "running",
      updatedAt: new Date(T0 - 5_000).toISOString(),
    })
  );
  const { changed } = reconcileActiveRuns(state, () => ({ kind: "active", status: "running" }), () => T0);
  assert.equal(changed, false);
  assert.equal(hasActiveRun(state), true);
});

test("stale running run is released after execution window when agent unreachable", () => {
  const state = stateWith(
    run({
      id: "r-timeout",
      status: "running",
      createdAt: new Date(T0 - ACTIVE_EXECUTION_STALE_MS - 5_000).toISOString(),
      updatedAt: new Date(T0 - ACTIVE_EXECUTION_STALE_MS - 1).toISOString(),
    })
  );
  const { changed } = reconcileActiveRuns(state, () => ({ kind: "unreachable" }), () => T0);
  assert.equal(changed, true);
  assert.equal(state.runs[0].reasonCode, "console.run_stale_execution");
});

test("after failed reconciliation a new command would not be blocked", () => {
  const state = stateWith(
    run({
      id: "r-fail",
      status: "queued",
      createdAt: new Date(T0 - 60_000).toISOString(),
      updatedAt: new Date(T0 - 60_000).toISOString(),
    })
  );
  reconcileActiveRuns(state, () => ({ kind: "missing" }), () => T0);
  assert.equal(hasActiveRun(state), false);
});
