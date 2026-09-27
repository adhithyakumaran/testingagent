import { spawn } from "child_process";
import path from "path";
import type { AgentRun, KnowledgePill, TraceEvent } from "@/lib/types";
import { repoRoot } from "@/lib/repo-root";
import { applyOrchestratorResultToRun, enrichWaitingRunFromAgent } from "@/lib/orchestrator-bridge";
import { shouldSkipDuplicateOrchestration } from "@/lib/run-execution-guard";
import { emitRunSubmitDiagnostic } from "@/lib/run-submit-diagnostics";
import { fetchWarmAgentRunResult, pollWarmAgentRunResult, postWarmAgentRun } from "@/lib/warm-agent-client";
import { uid } from "@/lib/utils";

const REPO_ROOT = repoRoot();

async function probeWarmAgentRun(runId: string): Promise<Record<string, unknown> | null> {
  const polled = await fetchWarmAgentRunResult(runId);
  if (!polled) return { _probe: "unreachable" };
  if (polled.httpStatus === 404) return null;
  return polled.body;
}

async function recoverWarmAgentResult(
  runId: string
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string; via?: string } | null> {
  const polled = await pollWarmAgentRunResult(runId);
  if (polled.ok) return polled;
  if (polled.error === "warm_agent_run_not_found") return null;
  return polled;
}

function extractPills(pills: KnowledgePill[]) {
  return pills.map((p) => {
    const extracted: Record<string, unknown> = {
      format: p.format,
      chars: p.content.length,
      tags: p.tags,
    };
    if (p.format === "json") {
      try {
        extracted.json = JSON.parse(p.content);
      } catch {
        extracted.parse_error = true;
      }
    }
    if (p.format === "csv") {
      const lines = p.content.trim().split(/\r?\n/);
      extracted.rows = Math.max(0, lines.length - 1);
      extracted.headers = lines[0]?.split(",").map((h) => h.trim()) || [];
    }
    if (p.format === "url") {
      extracted.urls = p.content
        .split(/\s+/)
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u));
    }
    return { ...p, extracted };
  });
}

async function invokeWarmAgent(
  goal: string,
  opts: {
    runType: string;
    model: string;
    contextPackets: Record<string, unknown>[];
    runId?: string;
    executionMode?: string;
  }
) {
  return postWarmAgentRun(goal, opts);
}

async function invokePythonAgentSpawn(
  goal: string,
  opts: { runType: string; model: string; runId?: string }
): Promise<{
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  via?: string;
}> {
  return new Promise((resolve) => {
    const args = [
      "-m",
      "qa_orchestrator.api",
      goal,
      "--discovery-root",
      "data/discovery-kb",
      "--type",
      opts.runType,
    ];
    if (opts.model && opts.model !== "disabled") {
      args.push("--model", opts.model);
    }
    if (opts.runId) {
      args.push("--run-id", opts.runId);
    }
    const pyBin = process.platform === "win32" ? "python" : "python3";
    const py = spawn(pyBin, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        LLM_ENABLED: opts.model === "disabled" ? "false" : "true",
        QA_DISCOVERY_ROOT: path.join(REPO_ROOT, "data", "discovery-kb"),
        QA_AUTOMATION_DIR: path.join(REPO_ROOT, "apps", "automation"),
        PYTHONPATH: [
          path.join(REPO_ROOT, "services", "agent-runtime"),
          path.join(REPO_ROOT, "services", "qa-orchestrator"),
          REPO_ROOT,
        ].join(path.delimiter),
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      py.kill("SIGKILL");
      resolve({ ok: false, error: "spawn_timeout", via: "spawn" });
    }, 120_000);
    py.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    py.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    py.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, via: "spawn" });
    });
    py.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, error: stderr || `exit ${code}`, via: "spawn" });
        return;
      }
      try {
        const jsonStart = stdout.indexOf("{");
        const parsed = JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
        resolve({ ok: true, result: parsed, via: "spawn" });
      } catch {
        resolve({ ok: false, error: "Failed to parse agent JSON", result: { raw: stdout }, via: "spawn" });
      }
    });
  });
}

async function invokePythonAgent(
  goal: string,
  opts: {
    runType: string;
    model: string;
    contextPackets: Record<string, unknown>[];
    runId?: string;
    executionMode?: string;
  }
) {
  const warm = await invokeWarmAgent(goal, opts);
  if (warm.ok) return warm;

  if (opts.runId) {
    const probe = await probeWarmAgentRun(opts.runId);
    if (probe && !probe._probe) {
      const recovered = await recoverWarmAgentResult(opts.runId);
      if (recovered?.ok) return recovered;
      return {
        ok: false,
        error: recovered?.error || "warm_agent_still_running",
        via: recovered?.via || "warm",
      };
    }
    if (probe && probe._probe === "unreachable") {
      return {
        ok: false,
        error: "warm_agent_unreachable_without_duplicate_spawn",
        via: "warm",
      };
    }
  }

  return invokePythonAgentSpawn(goal, opts);
}

export async function executeRun(
  run: AgentRun,
  pills: KnowledgePill[],
  onUpdate: (run: AgentRun) => Promise<void>
): Promise<AgentRun> {
  if (shouldSkipDuplicateOrchestration(run)) {
    emitRunSubmitDiagnostic("PLAYWRIGHT_END", `run_id=${run.id} skipped_duplicate=true`);
    return run;
  }

  const push = async (kind: TraceEvent["kind"], message: string, detail?: string) => {
    run.traces.push({
      id: uid("tr"),
      at: new Date().toISOString(),
      kind,
      message,
      detail,
    });
    run.updatedAt = new Date().toISOString();
    await onUpdate({ ...run, traces: [...run.traces] });
  };

  try {
    run.status = "running";
    await onUpdate(run);
    await push(
      "info",
      run.llmEnabled
        ? "Run accepted — enterprise orchestrator (Groq classify → Playwright suites)"
        : "Run accepted — deterministic classification (set GROQ_API_KEY for LLM)"
    );

    const extracted = extractPills(pills);
  run.knowledgePillIds = extracted.map((p) => p.id);
  const contextPackets = extracted.map((p) => ({
    id: p.id,
    title: p.title,
    format: p.format,
    extracted: p.extracted,
  }));

  if (extracted.length) {
    await push(
      "info",
      `Attached ${extracted.length} context packet(s) for planner RAG`,
      JSON.stringify(contextPackets, null, 2)
    );
  } else {
    await push("info", "No context packets — planner will use KB index");
  }

  await push("decision", `Classifier: ${run.model} · Executor: Playwright suites`);
  await push("tool", `Goal → ${run.goal.slice(0, 120)}`);

  const agentGoal =
    run.type === "sanity"
      ? run.goal.includes("sanity") || run.goal.includes("health")
        ? run.goal
        : `sanity check ${run.goal}`
      : run.goal;

  await push("tool", "Planning → executing → validating", agentGoal);
  emitRunSubmitDiagnostic("PLAYWRIGHT_START", `run_id=${run.id}`);
  const invoked = await invokePythonAgent(agentGoal, {
    runType: run.type === "scheduled" ? "sanity" : run.type,
    model: run.model,
    contextPackets,
    runId: run.id,
    executionMode: run.executionMode,
  });
  await push("info", `Orchestrator bridge via ${invoked.via || "unknown"}`);
  emitRunSubmitDiagnostic("PLAYWRIGHT_END", `run_id=${run.id} via=${invoked.via || "unknown"} ok=${invoked.ok}`);

  if (invoked.ok && invoked.result) {
    applyOrchestratorResultToRun(run, invoked.result, run.traces);
    const pausedForApproval = run.conclusion === "WAITING_FOR_APPROVAL";
    if (pausedForApproval) {
      await push(
        "decision",
        "Run paused — operator approval required before Playwright execution",
        run.reasonCode || "approval.pending"
      );
      const enriched = await enrichWaitingRunFromAgent(run);
      Object.assign(run, enriched);
      if (run.report?.json) {
        run.report.json.resumeToken = run.resumeToken;
      }
    } else {
      await push("decision", "Complete — no loop-until-success");
    }
  } else {
    run.conclusion = "UNKNOWN";
    run.reasonCode = "console.orchestrator_bridge_fallback";
    run.usage = {
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 0,
      steps: 1,
      llmCalls: 0,
    };
    await push(
      "error",
      "QA orchestrator bridge failed — start scripts/local_agent_server.py",
      invoked.error
    );
  }

  if (!invoked.ok || !invoked.result) {
    const orchestratorMd = "";
    const md =
      orchestratorMd ||
      [
        `# QA Agent Report`,
        ``,
        `- **Run ID:** ${run.id}`,
        `- **Type:** ${run.type}`,
        `- **Goal:** ${run.goal}`,
        `- **Conclusion:** ${run.conclusion}`,
        `- **Reason:** ${run.reasonCode || "n/a"}`,
        `- **Model:** ${run.model}`,
        ``,
        `## Trace`,
        ...run.traces.map((t) => `- \`${t.at}\` **${t.kind}** — ${t.message}`),
      ].join("\n");

    run.report = {
      summary: `${run.conclusion}: ${run.goal}`,
      markdown: md,
      json: {
        runId: run.id,
        conclusion: run.conclusion,
        reasonCode: run.reasonCode,
        usage: run.usage,
        traces: run.traces,
        knowledgePillIds: run.knowledgePillIds,
        agent: invoked.result || null,
        bridgeError: invoked.error || null,
        bridgeVia: invoked.via || null,
      },
    };
    run.status = "failed";
  }

    await push("report", "Report generated");
    emitRunSubmitDiagnostic("REPORT_FINALIZED", `run_id=${run.id}`);
    run.updatedAt = new Date().toISOString();
    await onUpdate(run);
    return run;
  } catch (err) {
    if (run.status === "running" || run.status === "queued" || run.status === "resuming") {
      run.status = "failed";
      run.conclusion = run.conclusion || "FAIL";
      run.reasonCode = run.reasonCode || "console.execute_run_failed";
      run.updatedAt = new Date().toISOString();
      run.traces.push({
        id: uid("tr"),
        at: new Date().toISOString(),
        kind: "error",
        message: "Run execution aborted before completion",
        detail: String(err),
      });
      await onUpdate(run).catch(() => undefined);
    }
    return run;
  }
}
