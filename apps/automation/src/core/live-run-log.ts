/** High-level LIVE run / flow markers on stderr (no secrets). */
export function emitLiveRunMarker(marker: string, detail = ''): void {
  const suffix = detail ? ` ${detail}` : '';
  process.stderr.write(`LIVE_RUN:${marker}${suffix}\n`);
}

export function emitLiveRunDiagnostics(diagnostics: Record<string, number>): void {
  process.stderr.write(`LIVE_DIAGNOSTICS:${JSON.stringify(diagnostics)}\n`);
}

/** Extract BF-* flow id from Playwright test tags or title. */
export function flowIdFromTestTags(tags: string[], title: string): string {
  for (const tag of tags) {
    const normalized = tag.startsWith('@') ? tag.slice(1) : tag;
    if (/^BF-[A-Z0-9-]+$/.test(normalized)) return normalized;
  }
  const match = title.match(/BF-[A-Z0-9-]+/);
  return match ? match[0] : process.env.QA_FLOW_ID || 'unknown-flow';
}
