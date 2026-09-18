# ScoutAI / Testing Agent — Director Demo Prep  
**5-page brief · Oracle APEX Endless Aisle UAT · Sep 2026**  
Repo: [testingagent](https://github.com/adhithyakumaran/testingagent)

---

## PAGE 1 — Cover & executive summary

### What this is

**ScoutAI** is an enterprise QA platform for **Oracle APEX Endless Aisle (UAT)**. Testers and leads use **plain English** to run controlled checks; the system **plans**, **executes in a real browser**, **captures evidence**, and **reports** PASS / FAIL / NEEDS REVIEW — with **SME Ground Truth** and **approval gates** so automation stays trustworthy.

### One sentence for the room

> “We turned UAT sanity and ad-hoc verification into a governed product: natural-language commands, deterministic Playwright execution, auditable flows, and multi-channel reporting — not a brittle script zoo.”

### Who it’s for

| Audience | What they get |
|----------|----------------|
| **QA / UAT leads** | Morning sanity, flow catalog, approvals, evidence |
| **SMEs** | Ground Truth sign-off, executable-only runs after approval |
| **Directors** | Visibility: readiness counts, run timeline, connectors, audit trail |

### Differentiators (say these out loud)

1. **Deterministic execution** — Browser steps are Playwright; LLM is for understanding goals, not clicking blindly.  
2. **Flow knowledge base** — ~19 approved business flows (`BF-*`) with scenarios, cases, suites.  
3. **Execution Gate + GT** — Nothing “executable” without governance; honest **NEEDS_REVIEW** before SME GT.  
4. **P12 Flow Resolver** — Wrong flow for “view vs search” is blocked (**FLOW_MISMATCH**), not silently run.  
5. **Enterprise console (P13)** — Full-width UI, **master/detail flows**, command workspace, connectors dashboard.

### Demo URL (local)

`http://127.0.0.1:43123` after `./scripts/start_local_stack.sh` (or backend `:43124` + console dev).

---

## PAGE 2 — Architecture (high level)

### System map (30-second whiteboard)

```
┌─────────────────────────────────────────────────────────────┐
│  ScoutAI Console (Next.js) — apps/console                    │
│  Ask Agent · Runs · Flows · Evidence · Approvals · Connectors│
└────────────────────────────┬────────────────────────────────┘
                             │ REST / SSE
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Local Agent Server — scripts/local_agent_server.py          │
│  Runs API · orchestration · browser session · reports        │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  QA Orchestrator — services/qa-orchestrator                  │
│  Intent → Flow Resolver (P12) → Suite select → Playwright    │
│  Validator · reports · decision diagnostics                  │
└───────┬─────────────────────────────┬───────────────────────┘
        ▼                             ▼
┌──────────────────┐         ┌──────────────────────────────┐
│ Agent runtime    │         │ Knowledge & design artifacts │
│ (LLM gateway,    │         │ data/discovery-kb/flows/     │
│  budgets, legacy │         │ apps/automation/test-design/ │
│  graph — shared) │         │ apps/automation/tests/       │
└──────────────────┘         └──────────────────────────────┘
        │                             │
        └─────────────┬───────────────┘
                      ▼
            Chromium → Oracle APEX UAT
                      ▼
            Evidence · traces · PASS/FAIL/NEEDS_REVIEW
                      ▼
            Email · WhatsApp · scheduled sanity
```

### Repo layout (what lives where)

| Path | Role |
|------|------|
| `apps/console/` | Product UI (ScoutAI) |
| `apps/automation/` | Playwright specs + `test-design/flows/BF-*` |
| `services/qa-orchestrator/` | Planning, gates, runner invocation |
| `services/agent-runtime/` | Shared LLM / agent kernel (not the hot-path clicker) |
| `data/discovery-kb/` | Flow KB YAML, crawl/discovery artifacts |
| `plugins/qa_apex/` | APEX-oriented skills, crawler helpers |
| `tests/` | Unit/regression for resolver, GT, run metadata |

### Design principle (directors care about risk)

**Separate “understand the request” from “execute the test.”**  
Classification and flow selection can use LLM *within allowed lists*; **Playwright runs zero LLM at execution time**. **ExecutionGate** and **Ground Truth** are deterministic guardrails.

---

## PAGE 3 — What’s built today (show, don’t oversell)

### Product surfaces (console)

| Area | Capability |
|------|------------|
| **Ask Agent** | Command workspace, suggestions (SKU search, login, sanity), readiness strip, latest run PLAN→EXECUTE→OBSERVE→VERIFY |
| **Runs** | Live status, approval resume, browser lifecycle (single-browser demo mode) |
| **Flows** | Master/detail: pick `BF-PRODUCT-003` left → detail right; verified **navigation path** nodes |
| **Evidence** | Screenshots / artifacts from runs |
| **Approvals** | SME queue; executable flows after sign-off |
| **Connectors** | UAT env, Playwright/LIVE_DEMO, email/WhatsApp/schedule, policy cards |
| **Agent chat** | Bottom-right prism FAB — assist without blocking main UI |

### Automation & knowledge

- **~19 sanity flows** (`npm run test:sanity` in `apps/automation`).  
- Per flow: `scenarios.yaml` → `test-cases.yaml` → `suite.yaml` → Playwright specs (e.g. `BF-PRODUCT-FLOWS.spec.ts`).  
- **Canonical flow audit** (P12): `data/discovery-kb/flows/p12-canonical-flow-audit.yaml`.  
- **Recent hardening:** BF-PRODUCT-004 positive discovery, run metadata sync, Windows-safe run store.

### Orchestrator modes (NL examples)

| User says | System behavior |
|-----------|-----------------|
| “Morning sanity check …” | All `@sanity` suites |
| “Search SKU 552811DUDABA00” | Parameterized product search flow |
| “View product using SKU …” | **View** flow (004), not search-only (003) — resolver enforced |
| “Full regression” | Regression manifest |

### Governance stack (trust story)

```
SME-ready design → Approval audit → ExecutionGate → Run → GT validator → Report
```

If GT not approved: business outcome shows **NEEDS_REVIEW** (honest), not fake PASS.

---

## PAGE 4 — How a run works (demo script + code anchors)

### Live demo flow (8–10 minutes)

1. **Open Ask Agent** — Show command card; type: `Search SKU 552811DUDABA00` → **Run controlled test**.  
2. **Readiness strip** — Executable / SME ready / awaiting approval / UAT connected.  
3. **Latest run** — Four phases; terminal state **PASS** or **NEEDS_REVIEW** (explain GT phase).  
4. **Flows** — Click **BF-PRODUCT-003** (left); right panel: Overview + **blue verified path** Home → Item Search → Search → Result.  
5. **Contrast** — **BF-PRODUCT-004** adds **Product Detail** (view vs search story + P12).  
6. **Connectors** — Environment CONNECTED, report channels, schedule 08:00 IST.  
7. **Optional CLI** — `npm run test:flow:positive -- BF-PRODUCT-003` (directors like “there’s an escape hatch”).

### Code path (if asked “where is this implemented?”)

| Step | Where |
|------|--------|
| UI submit | `apps/console/components/scout-app.tsx` → `/api/runs` |
| Plan + flow pick | `services/qa-orchestrator/qa_orchestrator/qa_planner.py` + `flow_resolver.py` |
| Intent (search vs view) | `flow_intent.py` / classifier — **view** must not route to search-only flow |
| Gate before run | `execution_gate.py` — SME approval, executable flags |
| Run Playwright | `playwright_runner.py` → `apps/automation/run-flow.mjs` |
| GT / conclusion | `gt_eval.py`, run display helpers in `apps/console/lib/run-display.ts` |
| Flow detail API | `apps/console/app/api/flows/[id]/route.ts` (reads KB + test-design) |

### P12 resolver (30-second technical pitch)

```
User text → capability + candidates from KB audit (never invented IDs)
         → deterministic score + product constraints
         → EXECUTE | FLOW_MISMATCH | DISCOVERY_REQUIRED
```

**FLOW_MISMATCH** = “We refuse to run the wrong BF-* flow.” That’s enterprise QA, not demo magic.

### Important “what we did NOT break” (credibility)

Recent phases explicitly preserved: **Ground Truth semantics**, **ExecutionGate**, **browser lifecycle**, **Playwright grep/tag contracts** — UI and resolver work sit *around* execution, not inside it.

---

## PAGE 5 — What’s next, risks, and director Q&A

### Near-term roadmap (realistic)

| Priority | Item | Why it matters |
|----------|------|----------------|
| **1** | SME GT session → flip flows to **deterministic PASS/FAIL** | Closes the trust loop directors asked for |
| **2** | Expand P12 audit coverage beyond core product/home flows | Fewer DISCOVERY_REQUIRED dead ends |
| **3** | Azure/OCI deploy path (`infra/`) + token hardening for prod | Go-live, not just laptop demo |
| **4** | Teams report channel parity with email/WhatsApp | Client comms completeness |
| **5** | Optional LLM rerank on resolver (still bounded list) | Better NL without unsafe execution |

### Known limits (answer honestly)

- **GT not fully signed everywhere** → some runs end **NEEDS_REVIEW** by design.  
- **Heavy agent kernel** exists for platform future; **product hot path** is orchestrator + Playwright.  
- **Live demo** depends on UAT credentials and network; have **dry_run** or recorded evidence backup.  
- **Discovery / draft flows** need SME approval before executable.

### Likely director questions — short answers

| Question | Answer |
|----------|--------|
| “Is AI clicking our production?” | **UAT only**; controlled runs; gate + approvals; evidence retained. |
| “Can it hallucinate a test?” | Executable flows come from **KB + audit**; resolver blocks mismatch; Playwright is scripted. |
| “ROI?” | Cuts morning sanity + ad-hoc from manual repetition; one console for status, flows, reports. |
| “Vendor lock-in?” | Standard stack: Node, Python, Playwright; KB in YAML; swappable LLM provider. |
| “Security?” | API tokens, loopback defaults, secrets in env — see P10.1 hardening docs. |

### Pre-meeting checklist (today)

- [ ] `./scripts/start_local_stack.sh` — console loads, top bar **Connected**  
- [ ] Run one SKU search + one sanity phrase before the call  
- [ ] Flows page: select **BF-PRODUCT-003** and **BF-PRODUCT-004** (master/detail, no scroll)  
- [ ] Have **Evidence** or last run report ready if live UAT fails  
- [ ] One slide or this doc on screen — **not** the full `docs/` tree  

### Closing line

> “This is a **governed QA product**, not a chatbot with a browser. We’ve built the console, the flow library, deterministic execution, and the governance to earn SME sign-off — today we show the happy path and where GT completes the story.”

---

*End of 5-page brief · Print or PDF export from this file for the meeting.*
