import { executeRun } from "@/lib/agent-runner";
import { deliverReport } from "@/lib/notify";
import { mutateState, pushHistory } from "@/lib/store";
import { applyAutomationEnvToProcess } from "@/lib/uat-env";
import type { AgentRun } from "@/lib/types";
import { uid } from "@/lib/utils";

export async function executeRunInBackground(
  runId: string,
  opts: { knowledgeIds: string[]; notify: string[]; headed?: boolean }
) {
  await applyAutomationEnvToProcess();
  if (opts.headed) {
    process.env.QA_HEADED = "true";
    process.env.EA_HEADLESS = "false";
  }

  await mutateState(async (state) => {
    const idx = state.runs.findIndex((r) => r.id === runId);
    if (idx < 0) return;
    let run = state.runs[idx];
    run.status = "running";
    state.runs[idx] = run;

    const pills = state.knowledge.filter((k) => opts.knowledgeIds.includes(k.id));
    run = await executeRun(run, pills, async (updated) => {
      const i = state.runs.findIndex((r) => r.id === updated.id);
      if (i >= 0) state.runs[i] = { ...updated };
      await mutateState((s) => {
        const j = s.runs.findIndex((r) => r.id === updated.id);
        if (j >= 0) s.runs[j] = { ...updated };
      });
    }, { headed: opts.headed });

    if (opts.notify.length && run.report) {
      const deliveries = await deliverReport(run, state.channels, opts.notify);
      run.channelsNotified = deliveries.map((d) => `${d.channel}:${d.mode}`);
      run.traces.push({
        id: uid("tr"),
        at: new Date().toISOString(),
        kind: "report",
        message: `Report delivery: ${deliveries.map((d) => `${d.channel}=${d.mode}`).join(", ")}`,
      });
    }

    state.runs[idx] = run;
    state.usageTotal.tokensIn += run.usage.tokensIn;
    state.usageTotal.tokensOut += run.usage.tokensOut;
    state.usageTotal.runs += 1;
    pushHistory(state, `Finished ${run.status}: ${run.conclusion}`, "agent", {
      runId,
      conclusion: run.conclusion,
    });
  });
}

export function inferRunType(goal: string): AgentRun["type"] {
  const g = goal.toLowerCase();
  if (g.includes("discover") || g.includes("crawl")) return "discover";
  if (g.includes("sanity") || g.includes("morning")) return "sanity";
  if (g.includes("regression")) return "adhoc";
  return "adhoc";
}
