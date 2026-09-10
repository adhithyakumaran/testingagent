import { NextResponse } from "next/server";
import { executeRunInBackground, inferRunType } from "@/lib/run-worker";
import { hasActiveRun, mutateState, pushHistory, readState } from "@/lib/store";
import type { AgentRun } from "@/lib/types";
import { uid } from "@/lib/utils";

export async function GET() {
  const state = await readState();
  return NextResponse.json({ runs: state.runs, history: state.history, locked: hasActiveRun(state) });
}

export async function POST(req: Request) {
  const body = await req.json();
  const goal = String(body.goal || "").trim();
  if (!goal) return NextResponse.json({ error: "Command required" }, { status: 400 });

  const type = (body.type || inferRunType(goal)) as AgentRun["type"];
  const knowledgeIds: string[] = Array.isArray(body.knowledgeIds) ? body.knowledgeIds : [];
  const notify: string[] =
    Array.isArray(body.channels) && body.channels.length > 0
      ? body.channels
      : body.notify === false
        ? []
        : [];
  const headed = body.headed !== false;

  const gate = await readState();
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
      traces: [],
      usage: { tokensIn: 0, tokensOut: 0, toolCalls: 0, steps: 0, llmCalls: 0 },
      knowledgePillIds: knowledgeIds,
      channelsNotified: [],
    };
    runId = run.id;
    state.runs = [run, ...state.runs].slice(0, 100);
    pushHistory(state, `Started ${type}: ${goal.slice(0, 80)}`, "client", { runId, goal, headed });
  });

  if (!runId) {
    return NextResponse.json({ error: "Could not acquire run lock", locked: true }, { status: 409 });
  }

  void executeRunInBackground(runId, { knowledgeIds, notify, headed });

  const state = await readState();
  const run = state.runs.find((r) => r.id === runId);
  return NextResponse.json({ run, locked: false, async: true }, { status: 202 });
}
