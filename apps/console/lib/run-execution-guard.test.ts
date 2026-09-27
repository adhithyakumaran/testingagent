import assert from "node:assert/strict";
import test from "node:test";
import {
  findRecentRunWithGoal,
  orchestrationBridgeRecorded,
  shouldSkipDuplicateOrchestration,
} from "./run-execution-guard.ts";
import type { AgentRun } from "./types.ts";

const baseRun = (overrides: Partial<AgentRun>): AgentRun => ({
  id: "run_1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  type: "adhoc",
  goal: "goal",
  status: "running",
  model: "disabled",
  llmEnabled: false,
  traces: [],
  usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
  ...overrides,
});

test("orchestrationBridgeRecorded detects warm/spawn completion trace", () => {
  const run = baseRun({
    traces: [{ id: "t1", at: "", kind: "info", message: "Orchestrator bridge via warm" }],
  });
  assert.equal(orchestrationBridgeRecorded(run.traces), true);
  assert.equal(shouldSkipDuplicateOrchestration(run), true);
});

test("findRecentRunWithGoal matches same goal within window", () => {
  const runs = [
    baseRun({ id: "run_a", goal: "Run BF-HOME-010-01 Item Search", createdAt: new Date().toISOString() }),
    baseRun({ id: "run_b", goal: "other", createdAt: new Date().toISOString() }),
  ];
  const hit = findRecentRunWithGoal(runs, "run bf-home-010-01 item search");
  assert.equal(hit?.id, "run_a");
});
