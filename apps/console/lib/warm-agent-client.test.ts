import assert from "node:assert/strict";
import test from "node:test";
import { pollWarmAgentRunResult, postWarmAgentRun } from "./warm-agent-client.ts";

const originalFetch = globalThis.fetch;

test("postWarmAgentRun accepts 202 and polls until completed payload", async () => {
  let pollCalls = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith("/run")) {
      return {
        ok: true,
        status: 202,
        json: async () => ({ ok: true, accepted: true, run_id: "run_poll", status: "running" }),
      } as Response;
    }
    if (href.includes("/agent/run_poll/result")) {
      pollCalls += 1;
      if (pollCalls < 2) {
        return {
          ok: true,
          status: 202,
          json: async () => ({ ok: true, status: "running", run_id: "run_poll" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: "completed",
          run_id: "run_poll",
          result: {
            conclusion: "PASS",
            local: { execution: { observations: [{ meta: { evidence: [{ path: "ev.png" }] } }] } },
          },
        }),
      } as Response;
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;

  const outcome = await postWarmAgentRun("goal", {
    runType: "adhoc",
    model: "disabled",
    contextPackets: [],
    runId: "run_poll",
    executionMode: "CI",
  });
  globalThis.fetch = originalFetch;

  assert.equal(outcome.ok, true);
  assert.equal(outcome.via, "warm-poll");
  const local = (outcome.result?.local as Record<string, unknown>) || {};
  const execution = local.execution as Record<string, unknown>;
  assert.ok(Array.isArray(execution.observations));
  assert.equal(pollCalls, 2);
});

test("postWarmAgentRun recovers via poll when POST body read fails after accept", async () => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith("/run")) {
      throw new Error("WinError 10053");
    }
    if (href.includes("/agent/run_disconnect/result")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: "completed",
          run_id: "run_disconnect",
          result: { conclusion: "PASS", local: { suite_plan: { primary_executable_flow_id: "BF-HOME-010-01" } } },
        }),
      } as Response;
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;

  const outcome = await postWarmAgentRun("goal", {
    runType: "adhoc",
    model: "disabled",
    contextPackets: [],
    runId: "run_disconnect",
  });
  globalThis.fetch = originalFetch;

  assert.equal(outcome.ok, true);
  assert.equal(outcome.via, "warm-disconnect-recover");
  const local = (outcome.result?.local as Record<string, unknown>) || {};
  const suite = local.suite_plan as Record<string, unknown>;
  assert.equal(suite.primary_executable_flow_id, "BF-HOME-010-01");
});

test("pollWarmAgentRunResult surfaces execution details for UI hydration", async () => {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "completed",
        run_id: "run_ui",
        result: {
          local: {
            suite_plan: { primary_executable_flow_id: "BF-HOME-010-01" },
            execution: { observations: [] },
          },
        },
      }),
    }) as Response) as typeof fetch;

  const outcome = await pollWarmAgentRunResult("run_ui", { deadlineMs: 1_000, intervalMs: 1 });
  globalThis.fetch = originalFetch;
  assert.equal(outcome.ok, true);
  assert.ok(outcome.result?.local);
});
