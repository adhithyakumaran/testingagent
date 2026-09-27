import { hydrateRunFromWarmAgent } from "@/lib/run-hydration";
import { mutateState, readState } from "@/lib/store";
import type { AgentRun } from "@/lib/types";

export async function persistRunSnapshot(id: string, run: AgentRun): Promise<void> {
  await mutateState((state) => {
    const idx = state.runs.findIndex((r) => r.id === id);
    if (idx >= 0) state.runs[idx] = run;
  });
}

/** Load a run for GET /api/runs/:id — hydrate from warm agent without blocking polls. */
export async function loadRunForClient(id: string): Promise<AgentRun | null> {
  const state = await readState();
  const existing = state.runs.find((r) => r.id === id);
  if (!existing) return null;

  try {
    const hydrated = await hydrateRunFromWarmAgent(existing, { allowPoll: false });
    if (hydrated !== existing) {
      try {
        await persistRunSnapshot(id, hydrated);
      } catch (err) {
        console.warn("[run-get] failed to persist hydrated run", id, err);
      }
      return hydrated;
    }
  } catch (err) {
    console.warn("[run-get] hydrate failed; returning stored run", id, err);
  }
  return existing;
}
