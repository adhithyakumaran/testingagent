import assert from "node:assert/strict";
import test from "node:test";
import { countEvidenceCaptures } from "./run-hydration.ts";
import type { AgentRun } from "./types.ts";

function bridgeFailedRun(): AgentRun {
  return {
    id: "run_9xfoc6qqx93n",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    type: "adhoc",
    goal: "LIVE demo",
    status: "failed",
    model: "disabled",
    llmEnabled: false,
    traces: [{ id: "t1", at: new Date().toISOString(), kind: "error", message: "bridge failed" }],
    usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
    reasonCode: "console.orchestrator_bridge_fallback",
    report: {
      summary: "UNKNOWN",
      markdown: "",
      json: {
        runId: "run_9xfoc6qqx93n",
        agent: { local: { classifier: "warm_agent_recovered" } },
      },
    },
  };
}

function warmResultWithFourEvidence(): Record<string, unknown> {
  const evidence = [
    { path: "reports/evidence/run_9xfoc6qqx93n/1.png" },
    { path: "reports/evidence/run_9xfoc6qqx93n/2.png" },
    { path: "reports/evidence/run_9xfoc6qqx93n/3.png" },
    { path: "reports/evidence/run_9xfoc6qqx93n/4.png" },
  ];
  return {
    conclusion: "PASS",
    reason_code: "validator.pass",
    local: {
      suite_plan: { primary_executable_flow_id: "BF-HOME-010-01", commands: ["npx playwright test"] },
      execution: {
        observations: evidence.map((ev) => ({ meta: { evidence: [ev] } })),
      },
      intent: { flow_ids: ["BF-HOME-010-01"], execution_mode: "LIVE_DEMO" },
      validation: { phase: "A", findings: [] },
    },
    decision_diagnostics: { live_diagnostics: { browsers: 1 } },
  };
}

test("countEvidenceCaptures returns 4 after warm-agent payload merge", async () => {
  const { hydrateRunFromWarmAgent } = await import("./run-hydration.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "completed",
        run_id: "run_9xfoc6qqx93n",
        result: warmResultWithFourEvidence(),
      }),
    }) as Response) as typeof fetch;

  const hydrated = await hydrateRunFromWarmAgent(bridgeFailedRun(), { allowPoll: false });
  globalThis.fetch = originalFetch;

  assert.equal(hydrated.conclusion, "PASS");
  assert.equal(countEvidenceCaptures(hydrated), 4);
  assert.equal(hydrated.report?.json?.agent?.local?.suite_plan?.primary_executable_flow_id, "BF-HOME-010-01");
});
