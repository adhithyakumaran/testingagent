export type ChatIntent =
  | { kind: "list_flows"; tag?: string }
  | { kind: "list_knowledge" }
  | { kind: "help" }
  | { kind: "run_agent" };

const RUN_PATTERNS = [
  /^(run|execute|start|trigger|launch)\b/i,
  /\b(run|execute|start)\s+(morning\s+)?sanity\b/i,
  /\btest\s+(payment|checkout|login|logout|regression|invoice|rivaah)\b/i,
  /\brun\s+full\s+regression\b/i,
  /\btrigger\s+(a\s+)?test\b/i,
];

const LIST_FLOW_PATTERNS = [
  /\bwhat (are |)(the )?flows\b/i,
  /\bwhich flows\b/i,
  /\blist (all |)(the )?flows\b/i,
  /\bshow (me )?(all |)(the )?flows\b/i,
  /\bflows (do )?you have\b/i,
  /\bflows?\s+(u|you)\s+(have|hav|got)\b/i,
  /\bwhat.*flows.*\b(have|hav|got)\b/i,
  /\bavailable flows\b/i,
  /\bhow many flows\b/i,
  /\bwhat can you test\b/i,
  /\bwhat do you cover\b/i,
  /\blist sanity flows\b/i,
  /\bshow sanity flows\b/i,
  /\bwhat.*sanity.*flows\b/i,
];

const KNOWLEDGE_PATTERNS = [
  /\blist.*doc/i,
  /\bknowledge\b/i,
  /\bfrom the db\b/i,
  /\bfetch.*doc/i,
  /\battached.*doc/i,
];

/** Classify chat messages before hitting the orchestrator — questions should not start runs. */
export function classifyChatIntent(text: string): ChatIntent {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (RUN_PATTERNS.some((p) => p.test(t))) {
    return { kind: "run_agent" };
  }

  if (/\bsanity\b/i.test(t) && /\b(all|every|full|check|run|flows?)\b/i.test(t)) {
    return { kind: "run_agent" };
  }

  if (LIST_FLOW_PATTERNS.some((p) => p.test(t))) {
    return { kind: "list_flows", tag: /sanity/.test(lower) ? "sanity" : undefined };
  }

  if (KNOWLEDGE_PATTERNS.some((p) => p.test(t))) {
    return { kind: "list_knowledge" };
  }

  if (/\bflows?\b/i.test(t) && /^(what|which|how|show|list|tell|do you|can you|any)\b/i.test(t)) {
    return { kind: "list_flows", tag: /sanity/.test(lower) ? "sanity" : undefined };
  }

  if (/\bflows?\b/i.test(t) && /\b(have|hav|got|available|cover)\b/i.test(t)) {
    return { kind: "list_flows" };
  }

  if (/^(what|which|how|why|can you|could you|do you|help)\b/i.test(t) && !/\b(run|test|execute|start)\b/i.test(t)) {
    if (/\bflows?\b/i.test(t)) return { kind: "list_flows" };
    return { kind: "help" };
  }

  // Safe default — never auto-run unless the user explicitly asked to run/test.
  if (/\b(run|execute|start|trigger|test)\b/i.test(t)) {
    return { kind: "run_agent" };
  }

  return { kind: "help" };
}
