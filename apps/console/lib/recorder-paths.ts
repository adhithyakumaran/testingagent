import path from "path";
import { repoRoot } from "@/lib/repo-root";

export function recorderSessionDir(sessionId: string): string {
  return path.join(repoRoot(), "data", "discovery-kb", "recordings", "sessions", sessionId);
}

export function recorderScriptPath(): string {
  return path.join(repoRoot(), "scripts", "browser_recorder.py");
}

export function pythonBin(): string {
  return process.platform === "win32" ? "python" : "python3";
}

export function recorderEnv(): NodeJS.ProcessEnv {
  const repo = repoRoot();
  return {
    ...process.env,
    PYTHONPATH: [
      path.join(repo, "services", "agent-runtime"),
      path.join(repo, "services", "qa-orchestrator"),
      repo,
    ].join(path.delimiter),
    QA_DISCOVERY_ROOT: path.join(repo, "data", "discovery-kb"),
  };
}

export { repoRoot };
