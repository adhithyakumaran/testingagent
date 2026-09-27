import assert from "node:assert/strict";
import test from "node:test";
import { submitAgentRun } from "./run-submit-client.ts";
import type { AgentRun } from "./types.ts";

const sampleRun = (id: string, overrides: Partial<AgentRun> = {}): AgentRun => ({
  id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  type: "adhoc",
  goal: "goal",
  status: "queued",
  model: "disabled",
  llmEnabled: false,
  traces: [],
  usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
  ...overrides,
});

test("network rejection releases client outcome without a run lock", async () => {
  const outcome = await submitAgentRun(
    async () => {
      throw new TypeError("fetch failed");
    },
    { goal: "x", type: "adhoc", channels: [] }
  );
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /fetch failed/i);
});

test("API failure returns error and does not report success", async () => {
  const outcome = await submitAgentRun(
    async () =>
      ({
        ok: false,
        status: 500,
        json: async () => ({ error: "server exploded" }),
      }) as Response,
    { goal: "x", type: "adhoc", channels: [] }
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, "server exploded");
});

test("409 locked with activeRunId attaches existing run instead of resubmitting", async () => {
  let postCalls = 0;
  const outcome = await submitAgentRun(
    async (url, init) => {
      if (url === "/api/runs" && init?.method === "POST") {
        postCalls += 1;
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: "locked", locked: true, activeRunId: "run_active" }),
        } as Response;
      }
      if (url === "/api/runs/run_active") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ run: sampleRun("run_active", { status: "running" }) }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ locked: true, runs: [] }),
      } as Response;
    },
    { goal: "x", type: "adhoc", channels: [] }
  );
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.run.id, "run_active");
    assert.equal(outcome.attached, true);
  }
  assert.equal(postCalls, 1);
});

test("409 after stale lock reconcile does not POST a second run", async () => {
  let postCalls = 0;
  const outcome = await submitAgentRun(
    async (url, init) => {
      if (url === "/api/runs" && init?.method === "POST") {
        postCalls += 1;
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: "locked", locked: true }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ locked: false, runs: [] }),
      } as Response;
    },
    { goal: "x", type: "adhoc", channels: [] }
  );
  assert.equal(postCalls, 1);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.locked, true);
});

test("timeout after accepted run attaches active run from GET list", async () => {
  const outcome = await submitAgentRun(
    async (url, init) => {
      if (url === "/api/runs" && init?.method === "POST") {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          locked: true,
          runs: [sampleRun("run_timeout", { status: "running", goal: "Search SKU 552811DUDABA00" })],
        }),
      } as Response;
    },
    { goal: "Search SKU 552811DUDABA00", type: "adhoc", channels: [] }
  );
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.run.id, "run_timeout");
});

test("polling path never POSTs — GET only helper", async () => {
  let postCalls = 0;
  await submitAgentRun(
    async (url, init) => {
      if (url === "/api/runs" && init?.method === "POST") {
        postCalls += 1;
        return {
          ok: true,
          status: 202,
          json: async () => ({ run: sampleRun("run_ok") }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ runs: [] }),
      } as Response;
    },
    { goal: "once", type: "adhoc", channels: [] }
  );
  assert.equal(postCalls, 1);
});

test("completed submit returns run payload", async () => {
  const outcome = await submitAgentRun(
    async () =>
      ({
        ok: true,
        status: 202,
        json: async () => ({ run: sampleRun("run_ok") }),
      }) as Response,
    { goal: "x", type: "adhoc", channels: [] }
  );
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.run.id, "run_ok");
});
