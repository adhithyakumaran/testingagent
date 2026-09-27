/** Client-side run submission lifecycle markers (console logs + optional detail). */
export type RunSubmitPhase =
  | "USER_SUBMIT"
  | "RUN_CREATED"
  | "RUN_ATTACH_EXISTING"
  | "RUN_RESUBMIT_ATTEMPT"
  | "PLAYWRIGHT_START"
  | "PLAYWRIGHT_END"
  | "REPORT_FINALIZED";

export function emitRunSubmitDiagnostic(phase: RunSubmitPhase, detail = ""): void {
  const suffix = detail ? ` ${detail}` : "";
  console.info(`[scout-run] ${phase}${suffix}`);
}
