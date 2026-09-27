import assert from "node:assert/strict";
import test from "node:test";
import { fetchRunById } from "./use-run-sync.ts";
import type { AgentRun } from "./types.ts";

const terminalRun = (): AgentRun => ({
  id: "run_terminal",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  type: "adhoc",
  goal: "done",
  status: "completed",
  conclusion: "PASS",
  model: "disabled",
  llmEnabled: false,
  traces: [],
  usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
  report: {
    summary: "PASS",
    markdown: "",
    json: {
      runId: "run_terminal",
      agent: {
        local: {
          suite_plan: { primary_executable_flow_id: "BF-HOME-010-01" },
          execution: { observations: [{ meta: { evidence: [{ path: "a.png" }] } }] },
        },
      },
    },
  },
});

test("fetchRunById returns hydrated terminal run on success", async () => {
  const run = terminalRun();
  const outcome = await fetchRunById("run_terminal", async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ run }),
    }) as Response);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.run.conclusion, "PASS");
  }
});

test("fetchRunById maps network failure without throwing", async () => {
  const outcome = await fetchRunById("run_terminal", async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error, "network_error");
    assert.match(outcome.message || "", /Failed to fetch/i);
  }
});

test("fetchRunById surfaces 500 http_error for retry logic", async () => {
  const outcome = await fetchRunById("run_terminal", async () =>
    ({
      ok: false,
      status: 503,
      json: async () => ({ error: "busy" }),
    }) as Response);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error, "http_error");
    assert.equal(outcome.status, 503);
  }
});
