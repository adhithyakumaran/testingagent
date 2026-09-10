import { promises as fs } from "fs";
import path from "path";
import { repoRoot } from "@/lib/repo-root";

const ENV_PATH = path.join(repoRoot(), "apps", "automation", "config", ".env");
const EXAMPLE_PATH = path.join(repoRoot(), "apps", "automation", "config", "environments.example.env");

export type UatCredentials = {
  baseUrl: string;
  loginUrl: string;
  username: string;
  passwordSet: boolean;
  password?: string;
  useSystemChrome: boolean;
  headless: boolean;
};

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function serializeEnv(vars: Record<string, string>, templateRaw: string): string {
  const lines = templateRaw.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
      if (key in vars) {
        out.push(`${key}=${vars[key]}`);
        seen.add(key);
        continue;
      }
    }
    out.push(line);
  }

  for (const [key, value] of Object.entries(vars)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }

  return out.join("\n").replace(/\n?$/, "\n");
}

async function readEnvFile(): Promise<Record<string, string>> {
  try {
    return parseEnv(await fs.readFile(ENV_PATH, "utf8"));
  } catch {
    try {
      return parseEnv(await fs.readFile(EXAMPLE_PATH, "utf8"));
    } catch {
      return {};
    }
  }
}

export async function getUatCredentials(): Promise<UatCredentials> {
  const env = await readEnvFile();
  const password = env.EA_USER_PASSWORD || "";
  return {
    baseUrl: env.EA_BASE_URL || "",
    loginUrl: env.EA_LOGIN_URL || "login",
    username: env.EA_USER_USERNAME || "",
    passwordSet: Boolean(password),
    useSystemChrome: env.EA_USE_SYSTEM_CHROME !== "false",
    headless: env.EA_HEADLESS === "true",
  };
}

export async function saveUatCredentials(input: {
  baseUrl?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  useSystemChrome?: boolean;
  headless?: boolean;
}): Promise<UatCredentials> {
  const current = await readEnvFile();
  let template = "";
  try {
    template = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    template = await fs.readFile(EXAMPLE_PATH, "utf8");
  }

  if (input.baseUrl !== undefined) current.EA_BASE_URL = input.baseUrl.trim();
  if (input.loginUrl !== undefined) current.EA_LOGIN_URL = input.loginUrl.trim();
  if (input.username !== undefined) current.EA_USER_USERNAME = input.username.trim();
  if (input.password !== undefined && input.password.length > 0) current.EA_USER_PASSWORD = input.password;
  if (input.useSystemChrome !== undefined) current.EA_USE_SYSTEM_CHROME = input.useSystemChrome ? "true" : "false";
  if (input.headless !== undefined) current.EA_HEADLESS = input.headless ? "true" : "false";

  await fs.mkdir(path.dirname(ENV_PATH), { recursive: true });
  await fs.writeFile(ENV_PATH, serializeEnv(current, template), "utf8");
  return getUatCredentials();
}

/** Load automation .env into process.env for Playwright subprocesses. */
export async function applyAutomationEnvToProcess(): Promise<void> {
  const env = await readEnvFile();
  for (const [key, value] of Object.entries(env)) {
    if (value) process.env[key] = value;
  }
}
