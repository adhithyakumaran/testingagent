import { spawn } from "child_process";
import path from "path";
import type { AgentRun, KnowledgePill, TraceEvent } from "@/lib/types";
import { repoRoot } from "@/lib/repo-root";
import { uid } from "@/lib/utils";

const REPO_ROOT = repoRoot();
const LOCAL_AGENT_URL = process.env.LOCAL_AGENT_URL || "http://127.0.0.1:43124";

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
  opts: { runType: string; model: string; contextPackets: Record<string, unknown>[]; headed?: boolean }
): Promise<{
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  via?: string;
}> {
  try {
    const res = await fetch(`${LOCAL_AGENT_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal,
        run_type: opts.runType,
        model: opts.model === "disabled" ? null : opts.model,
        context_packets: opts.contextPackets,
        headed: opts.headed === true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return { ok: false, error: `warm_agent_http_${res.status}`, via: "warm" };
    }
    const json = (await res.json()) as { ok?: boolean; result?: Record<string, unknown>; error?: string };
    if (!json.ok || !json.result) {
      return { ok: false, error: json.error || "warm_agent_bad_payload", via: "warm" };
    }
    return { ok: true, result: json.result, via: "warm" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      via: "warm",
    };
  }
}

async function invokePythonAgentSpawn(
  goal: string,
  opts: { runType: string; model: string; headed?: boolean }
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
    const pyBin = process.platform === "win32" ? "python" : "python3";
    const py = spawn(pyBin, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        LLM_ENABLED: opts.model === "disabled" ? "false" : "true",
        QA_DISCOVERY_ROOT: path.join(REPO_ROOT, "data", "discovery-kb"),
        QA_AUTOMATION_DIR: path.join(REPO_ROOT, "apps", "automation"),
        ...(opts.headed ? { QA_HEADED: "true", EA_HEADLESS: "false", EA_USE_SYSTEM_CHROME: "true" } : {}),
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
  opts: { runType: string; model: string; contextPackets: Record<string, unknown>[]; headed?: boolean }
) {
  const warm = await invokeWarmAgent(goal, opts);
  if (warm.ok) return warm;
  return invokePythonAgentSpawn(goal, opts);
}

export async function executeRun(
  run: AgentRun,
  pills: KnowledgePill[],
  onUpdate: (run: AgentRun) => Promise<void>,
  opts?: { headed?: boolean }
): Promise<AgentRun> {
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
  const invoked = await invokePythonAgent(agentGoal, {
    runType: run.type === "scheduled" ? "sanity" : run.type,
    model: run.model,
    contextPackets,
    headed: opts?.headed,
  });
  await push("info", `Orchestrator bridge via ${invoked.via || "unknown"}`);

  if (invoked.ok && invoked.result) {
    const r = invoked.result;
    const local = (r.local as Record<string, unknown> | undefined) || {};
    const intent = (local.intent as Record<string, unknown>) || {};
    const discovery = (local.discovery as Record<string, unknown>) || {};
    run.conclusion = String(r.conclusion || "UNKNOWN");
    run.reasonCode = String(r.reason_code || "");
    run.usage.toolCalls = Number(r.tool_calls || 0);
    run.usage.steps = Number(r.steps || 0);
    run.usage.llmCalls = Number(r.llm_calls || 0);
    run.usage.tokensIn = Number(r.tokens_in || 0);
    run.usage.tokensOut = Number(r.tokens_out || 0);

    await push(
      "decision",
      `Intent: ${String(intent.execution_mode || "unknown")} — ${String(intent.reasoning || "classified")}`,
      JSON.stringify(intent, null, 2)
    );

    const suggestions = discovery.suggestions as string[] | undefined;
    if (suggestions?.length) {
      await push(
        "observe",
        `Discovery insights (${suggestions.length})`,
        suggestions.join("\n")
      );
    }

    await push(
      "observe",
      `Validation phase ${String(local.validation_phase || "A")} → ${run.conclusion}`,
      JSON.stringify(
        {
          reason: run.reasonCode,
          classifier: local.classifier,
          execution_mode: local.execution_mode,
          executor: local.executor,
          suites: (local.suite_plan as { suite_ids?: unknown[] } | undefined)?.suite_ids,
        },
        null,
        2
      )
    );
    await push("decision", "Complete — no loop-until-success");
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

  const r = invoked.result || {};
  const local = (r.local as Record<string, unknown> | undefined) || {};
  const orchestratorMd = typeof local.report_markdown === "string" ? local.report_markdown : "";

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
      `- **Tool calls:** ${run.usage.toolCalls} · **Steps:** ${run.usage.steps} · **LLM calls:** ${run.usage.llmCalls}`,
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

  await push("report", "Report generated");
  run.status =
    run.conclusion === "FAIL"
      ? "failed"
      : run.conclusion === "BLOCKED"
        ? "blocked"
        : "completed";
  run.updatedAt = new Date().toISOString();
  await onUpdate(run);
  return run;
}
