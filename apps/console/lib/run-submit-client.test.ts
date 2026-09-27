import assert from "node:assert/strict";
import test from "node:test";
import { submitAgentRun } from "./run-submit-client.ts";
import type { AgentRun } from "./types.ts";

const sampleRun = (id: string): AgentRun => ({
  id,
  createdAt: "2026-01-01T12:00:00.000Z",
  updatedAt: "2026-01-01T12:00:00.000Z",
  type: "adhoc",
  goal: "goal",
  status: "queued",
  model: "disabled",
  llmEnabled: false,
  traces: [],
  usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
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

test("409 locked response surfaces concurrency error", async () => {
  const outcome = await submitAgentRun(
    async () =>
      ({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Another command is already running. Wait until it finishes.",
          locked: true,
          activeRunId: "run_active",
        }),
      }) as Response,
    { goal: "x", type: "adhoc", channels: [] },
    { reconcileOnLock: false }
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.locked, true);
  assert.equal(outcome.activeRunId, "run_active");
});

test("retries once after GET reconciliation clears stale lock", async () => {
  let postCalls = 0;
  const outcome = await submitAgentRun(
    async (url, init) => {
      if (url === "/api/runs" && init?.method === "POST") {
        postCalls += 1;
        if (postCalls === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: "locked", locked: true }),
          } as Response;
        }
        return {
          ok: true,
          status: 202,
          json: async () => ({ run: sampleRun("run_new") }),
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
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.run.id, "run_new");
  assert.equal(postCalls, 2);
});

test("timeout abort returns a retryable error", async () => {
  const outcome = await submitAgentRun(
    async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    },
    { goal: "x", type: "adhoc", channels: [] }
  );
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /timed out/i);
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
