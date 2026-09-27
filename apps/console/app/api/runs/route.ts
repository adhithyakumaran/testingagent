import { NextResponse } from "next/server";
import { executeRun } from "@/lib/agent-runner";
import { deliverReport } from "@/lib/notify";
import { requireApiAuth, requireMutationAuth } from "@/lib/api-auth";
import { shouldSkipDuplicateOrchestration } from "@/lib/run-execution-guard";
import { hasActiveRun, mutateState, pushHistory, readState, reconcileStoredRunLocks } from "@/lib/store";
import type { AgentRun } from "@/lib/types";
import { uid } from "@/lib/utils";

export async function GET(req: Request) {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const state = await reconcileStoredRunLocks();
  return NextResponse.json({ runs: state.runs, locked: hasActiveRun(state) });
}

function resolveExecutionMode(raw: unknown): AgentRun["executionMode"] {
  const mode = String(raw || "CI").toUpperCase();
  if (mode === "LIVE_DEMO" || mode === "LIVE" || mode === "DRY_RUN" || mode === "CI") return mode;
  return "CI";
}

export async function POST(req: Request) {
  const denied = requireMutationAuth(req);
  if (denied) return denied;
  const body = await req.json();
  const goal = String(body.goal || "").trim();
  if (!goal) return NextResponse.json({ error: "Command required" }, { status: 400 });

  const type = (body.type || "adhoc") as AgentRun["type"];
  const executionMode = resolveExecutionMode(body.executionMode ?? process.env.NEXT_PUBLIC_QA_EXECUTION_MODE ?? "LIVE_DEMO");
  const knowledgeIds: string[] = Array.isArray(body.knowledgeIds) ? body.knowledgeIds : [];
  const notify: string[] =
    Array.isArray(body.channels) && body.channels.length > 0
      ? body.channels
      : body.notify === false
        ? []
        : ["email", "whatsapp"];
  const asyncRun = body.async !== false;

  const gate = await reconcileStoredRunLocks();
  if (hasActiveRun(gate)) {
    return NextResponse.json(
      {
        error: "Another command is already running. Wait until it finishes.",
        locked: true,
        activeRunId: gate.runs.find((r) => r.status === "running" || r.status === "queued")?.id,
      },
      { status: 409 }
    );
  }

  let runId = "";
  await mutateState((state) => {
    if (hasActiveRun(state)) return;
    const run: AgentRun = {
      id: uid("run"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      type,
      goal,
      status: "queued",
      model: state.selectedModel,
      llmEnabled: state.selectedModel !== "disabled",
      executionMode,
      traces: [],
      usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
      knowledgePillIds: knowledgeIds,
      channelsNotified: [],
    };
    runId = run.id;
    state.runs = [run, ...state.runs].slice(0, 100);
    pushHistory(state, `Started ${type}: ${goal.slice(0, 80)}`, "client", {
      runId,
      goal,
      executionMode,
      phase: "RUN_CREATED",
    });
  });

  if (!runId) {
    return NextResponse.json({ error: "Could not acquire run lock", locked: true }, { status: 409 });
  }

  const finishRun = async () => {
    const backoffMs = [0, 500, 1500, 3000, 5000];
    let lastErr: unknown;
    for (const wait of backoffMs) {
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        await mutateState(async (state) => {
          const idx = state.runs.findIndex((r) => r.id === runId);
          if (idx < 0) return;
          let run = state.runs[idx];
          const ids = [...new Set([...(knowledgeIds || []), ...(run.knowledgePillIds || [])])];
          const pills = state.knowledge.filter((k) => ids.includes(k.id));
          run.knowledgePillIds = ids;
          const alreadyOrchestrated = shouldSkipDuplicateOrchestration(run);
          try {
            if (!alreadyOrchestrated) {
              run = await executeRun(run, pills, async (updated) => {
                const i = state.runs.findIndex((r) => r.id === updated.id);
                if (i >= 0) state.runs[i] = updated;
              });
            } else {
              run.traces.push({
                id: uid("tr"),
                at: new Date().toISOString(),
                kind: "info",
                message: "Skipped duplicate orchestration — run already executed",
                detail: runId,
              });
              run.updatedAt = new Date().toISOString();
            }
          } catch (err) {
            if (run.status === "running" || run.status === "queued" || run.status === "resuming") {
              run.status = "failed";
              run.conclusion = "FAIL";
              run.reasonCode = "console.finish_run_failed";
              run.updatedAt = new Date().toISOString();
              run.traces.push({
                id: uid("tr"),
                at: new Date().toISOString(),
                kind: "error",
                message: "Run execution failed unexpectedly",
                detail: String(err),
              });
            }
          }

          if (notify.length && run.report) {
            const deliveries = await deliverReport(run, state.channels, notify);
            run.channelsNotified = deliveries.map((d) => `${d.channel}:${d.mode}`);
            run.traces.push({
              id: uid("tr"),
              at: new Date().toISOString(),
              kind: "report",
              message: `Report delivery: ${deliveries.map((d) => `${d.channel}=${d.mode}`).join(", ")}`,
              detail: JSON.stringify(deliveries, null, 2),
            });
            pushHistory(state, `Report routed (${run.channelsNotified.join(", ")})`, "system", { runId });
          }

          state.runs[idx] = run;
          state.usageTotal.tokensIn += run.usage.tokensIn;
          state.usageTotal.tokensOut += run.usage.tokensOut;
          state.usageTotal.runs += 1;
          pushHistory(state, `Finished ${run.status}: ${run.conclusion}`, "agent", {
            runId,
            conclusion: run.conclusion,
            phase: "REPORT_FINALIZED",
          });
        });
        return;
      } catch (err) {
        lastErr = err;
        console.error("[runs] finishRun persist failed, retrying", err);
      }
    }
    await mutateState((state) => {
      const idx = state.runs.findIndex((r) => r.id === runId);
      if (idx < 0) return;
      const run = state.runs[idx];
      if (run.status === "running" || run.status === "queued") {
        run.status = "failed";
        run.conclusion =
          "Run finished but state persistence failed — refresh or check server logs.";
        run.updatedAt = new Date().toISOString();
        run.traces.push({
          id: uid("tr"),
          at: new Date().toISOString(),
          kind: "error",
          message: `finishRun persist error: ${String(lastErr)}`,
        });
        state.runs[idx] = run;
        pushHistory(state, "Run state write failed after retries", "system", { runId });
      }
    }).catch(() => undefined);
  };

  if (asyncRun) {
    void finishRun();
    const state = await readState();
    const run = state.runs.find((r) => r.id === runId);
    return NextResponse.json({ run, locked: true, async: true }, { status: 202 });
  }

  await finishRun();
  const state = await readState();
  const run = state.runs.find((r) => r.id === runId);
  return NextResponse.json({ run, locked: false });
}
