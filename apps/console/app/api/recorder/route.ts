import { NextResponse } from "next/server";
import { spawn } from "child_process";
import {
  pythonBin,
  recorderEnv,
  recorderScriptPath,
  repoRoot,
} from "@/lib/recorder-paths";

function runPython(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin(), [recorderScriptPath(), ...args], {
      cwd: repoRoot(),
      env: recorderEnv(),
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `recorder exit ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error("Invalid recorder JSON"));
      }
    });
  });
}

function spawnDetached(args: string[]): void {
  const proc = spawn(pythonBin(), [recorderScriptPath(), ...args], {
    cwd: repoRoot(),
    env: recorderEnv(),
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") || "scout-default";

  try {
    const status = await runPython(["status", "--session-id", sessionId]);
    return NextResponse.json({ status });
  } catch (e) {
    return NextResponse.json(
      { status: { session_id: sessionId, status: "idle" }, error: e instanceof Error ? e.message : String(e) },
      { status: 200 }
    );
  }
}

export async function PUT(req: Request) {
  const body = await req.json();
  const sessionId = String(body.sessionId || "scout-default");
  const config = body.config || {};
  try {
    const result = await runPython([
      "configure",
      "--session-id",
      sessionId,
      "--config-json",
      JSON.stringify(config),
    ]);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const sessionId = String(body.sessionId || "scout-default");
  const action = String(body.action || "start");
  const maxSeconds = Number(body.maxSeconds || 3600);
  const config = body.config || {};

  try {
    if (action === "stop") {
      const result = await runPython(["stop", "--session-id", sessionId]);
      return NextResponse.json(result);
    }

    await runPython(["configure", "--session-id", sessionId, "--config-json", JSON.stringify(config)]);
    spawnDetached([
      "start",
      "--session-id",
      sessionId,
      "--max-seconds",
      String(maxSeconds),
    ]);
    return NextResponse.json({
      ok: true,
      sessionId,
      status: "recording",
      stream: `/api/recorder/stream?sessionId=${encodeURIComponent(sessionId)}`,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
