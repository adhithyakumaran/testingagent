import assert from "node:assert/strict";
import test from "node:test";
import { hydrateRunFromWarmAgent, runNeedsAgentHydration } from "./run-hydration.ts";
import type { AgentRun } from "./types.ts";

const bridgeFailedRun = (): AgentRun => ({
  id: "run_bridge_fail",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  type: "adhoc",
  goal: "goal",
  status: "failed",
  model: "disabled",
  llmEnabled: false,
  traces: [],
  usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
  reasonCode: "console.orchestrator_bridge_fallback",
  report: {
    summary: "UNKNOWN",
    markdown: "",
    json: {
      runId: "run_bridge_fail",
      agent: { local: { classifier: "warm_agent_recovered" } },
      bridgeError: "WinError 10053",
    },
  },
});

test("runNeedsAgentHydration is true for bridge fallback without execution block", () => {
  assert.equal(runNeedsAgentHydration(bridgeFailedRun()), true);
});

test("hydrateRunFromWarmAgent merges full orchestrator payload into report", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "completed",
        run_id: "run_bridge_fail",
        result: {
          conclusion: "PASS",
          reason_code: "validator.pass",
          local: {
            suite_plan: { primary_executable_flow_id: "BF-HOME-010-01", commands: ["npx playwright test"] },
            execution: {
              observations: [{ meta: { evidence: [{ path: "reports/evidence/run_bridge_fail/step.png" }] } }],
            },
            intent: { flow_ids: ["BF-HOME-010-01"], execution_mode: "LIVE_DEMO" },
          },
        },
      }),
    }) as Response) as typeof fetch;

  const hydrated = await hydrateRunFromWarmAgent(bridgeFailedRun());
  globalThis.fetch = originalFetch;

  assert.equal(hydrated.conclusion, "PASS");
  assert.equal(hydrated.status, "completed");
  const agent = hydrated.report?.json?.agent as Record<string, unknown>;
  const local = (agent?.local as Record<string, unknown>) || {};
  const suite = local.suite_plan as Record<string, unknown>;
  assert.equal(suite.primary_executable_flow_id, "BF-HOME-010-01");
});
