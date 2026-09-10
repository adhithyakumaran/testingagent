import { promises as fs } from "fs";
import path from "path";
import { recorderSessionDir } from "@/lib/recorder-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") || "scout-default";
  const sessionDir = recorderSessionDir(sessionId);
  const eventsPath = path.join(sessionDir, "events.jsonl");
  const statusPath = path.join(sessionDir, "status.json");

  const encoder = new TextEncoder();
  let offset = 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const push = (payload: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      push({ kind: "connected", sessionId, at: new Date().toISOString() });

      while (!closed) {
        try {
          if (await fileExists(eventsPath)) {
            const raw = await fs.readFile(eventsPath, "utf8");
            const lines = raw.split("\n").filter(Boolean);
            while (offset < lines.length) {
              push(JSON.parse(lines[offset]!) as Record<string, unknown>);
              offset += 1;
            }
          }

          if (await fileExists(statusPath)) {
            const status = JSON.parse(await fs.readFile(statusPath, "utf8")) as {
              status?: string;
              events?: number;
            };
            if (status.status === "completed" || status.status === "stopped") {
              push({ kind: "session_end", ...status, at: new Date().toISOString() });
              controller.close();
              closed = true;
              return;
            }
          }
        } catch {
          /* retry on next tick */
        }

        if (req.signal.aborted) {
          closed = true;
          controller.close();
          return;
        }

        await sleep(50);
      }
    },
    cancel() {
      closed = true;
    },
  });

  req.signal.addEventListener("abort", () => {
    closed = true;
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
