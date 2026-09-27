# P11.7 — LIVE_DEMO single-browser run lifecycle

## Root cause (from P11.6 diagnosis)

| Issue | Cause |
| --- | --- |
| Multiple Chrome windows | `PlaywrightRunner.run_selection()` ran **one subprocess per suite command**; with `QA_KEEP_BROWSER_OPEN`, each subprocess called `launchPersistentContext()` on the same profile. |
| Two tests for one SKU npm | `run-flow.mjs` grep `(?=.*@BF-PRODUCT-003)(?=.*@positive)` also matched **`QA-PARAM-SKU-001`** (`@param-test` harness). |
| Repeated login | `authenticatedPage` called `ensureAuthenticated()` on every test even after `ensureRunScopedLogin()`. |
| Stale profile | No guard when DevTools port + ACTIVE session already held the profile path. |

## Lifecycle architecture (LIVE_DEMO)

```
ScoutAI run
  → SuiteSelector (commands unchanged for CI)
  → PlaywrightRunner.run_selection()
       • live + multiple flow commands → ONE node run-live-playwright.mjs subprocess
       • single command → ONE npm/playwright subprocess (unchanged entry)
  → worker-scoped liveContext (P11.6)
       • CDP attach if same run_id + ACTIVE profile + DevToolsActivePort
       • else launchPersistentContext (once) OR LIVE_BROWSER_STALE error
  → ensureRunScopedLogin() once (login_count++)
  → tests reuse session; authenticatedPage skips re-login when isLiveSessionAuthenticated()
  → evidence/report on disk
  → worker `liveContext` teardown closes browser once (`browser_close_count=1`)
  → orchestrator persists final run state and marks session `CLOSED`
```

**Normal Ask Agent QA:** `QA_KEEP_BROWSER_OPEN` defaults to **false** — browser closes automatically after the full run.

**Inspection / debugging only:** set `QA_KEEP_BROWSER_OPEN=true` to leave Chrome open (keeper + manual Close Browser via `close.signal`).

## Code changes

| Area | Change |
| --- | --- |
| `live_playwright_invoke.py` | Collapse rules, selection JSON, profile stale assessment, test count parse |
| `playwright_runner.py` | Live collapse path, shared `_prepare_live_subprocess_env`, diagnostics in observation meta |
| `run-live-playwright.mjs` | Single-process multi-flow runner (reads JSON selection file) |
| `run-flow.mjs` | Positive grep excludes `@param-test` |
| `scout-live.fixture.ts` | CDP reuse, stale guard, run-scoped auth skip in `authenticatedPage`, diagnostic counters |
| `live-browser-shared.ts` | `browser_launch_count`, `context_launch_count`, `login_count` |
| `controlled_agent_loop.py` | Persist `live_diagnostics`, commands, flow IDs in `state.metadata` |

## Test selection rule

**Flow positive runs** (`run-flow.mjs` / `run-live-playwright.mjs`):

- Must match flow tag **and** `@positive`.
- Must **not** match `@param-test` (CI-only param injection spec `QA-PARAM-SKU.spec.ts`).
- Cross-tagged flows (e.g. `@BF-PRODUCT-003` on home specs) still require `@positive` on the test title; home P01 uses `@sanity` only → not selected for SKU positive.

**SKU adhoc_parameterized:** one command `npm run test:flow:positive -- BF-PRODUCT-003` → **one** primary test `TC-BF-PRODUCT-003-P01` in LIVE_DEMO.

## Diagnostics (safe fields)

Persisted in execution observation `meta.live_diagnostics` and agent `state.metadata.live_diagnostics`:

- `run_id`, `playwright_process_count`, `browser_launch_count`, `context_launch_count`, `login_count`, `page_count`, `browser_close_count`, `selected_test_count`, `commands_count`

Never includes passwords, cookies, tokens, or auth storage.

**Expected SKU LIVE_DEMO success:**

| Counter | Value |
| --- | --- |
| playwright_process_count | 1 |
| browser_launch_count | 1 |
| context_launch_count | 1 |
| login_count | 1 |
| browser_close_count | 1 |
| selected_test_count | 1 |

## Tests

- `tests/unit/test_p11_7_live_demo_single_browser.py` — collapse, grep, stale profile, diagnostics shape, dry-run CI unchanged
- `apps/automation/tests/unit/live-browser-lifecycle.spec.ts` — keeper + shared context (existing)
- P11.6 export tests remain valid

Run:

```bash
PYTHONPATH=services/qa-orchestrator:services/agent-runtime pytest tests/unit/test_p11_7_live_demo_single_browser.py tests/unit/test_p11_6_live_browser_exports.py tests/unit/test_live_browser.py -q
cd apps/automation && npx playwright test tests/unit/live-browser-lifecycle.spec.ts
```

## Windows validation status

**Not verified in cloud agent** (no headed Windows Chrome / UAT in this environment).

Manual acceptance on Windows:

1. Goal: `Search SKU 552811DUDABA00`, LIVE_DEMO, BF-PRODUCT-003  
2. One Chrome window, one login, SKU visible in same session  
3. Run completes, Chrome remains open, Close Browser closes it, no second window  

Record `state.metadata.live_diagnostics` and `reports/live-events/{run_id}.jsonl` when validating.

## Known limitations

- Live collapse applies when **all** commands are `npm run test:flow:positive|negative -- BF-*`; sanity/regression live runs still use per-command subprocesses.
- CDP attach requires DevToolsActivePort in the profile directory; if Chrome crashed without updating `session.json`, operator may need Close Browser or manual cleanup.
- Separate ScoutAI runs use **separate** profile dirs (`reports/browser-profiles/{run_id}`); two visible windows from **two concurrent runs** are expected until each is closed.

## P11.7.1 — liveContext setup timeout (Windows)

**Root cause:** The worker `liveContext` fixture used a **30s setup budget** for both `launchPersistentContext()` **and** full `ensureAuthenticated()` (home + login navigations up to 60s each). Playwright reported `exceeded during setup`; orchestrator mis-labeled any `liveContext` timeout as teardown.

**Fix:** Split fixtures — `liveContext` (launch/attach only, 30s) + `liveSession` (single run-scoped login, test timeout). Fast LIVE login path (`live-run-scoped-auth.ts`), bounded CDP attach (8s), `LIVE_FIXTURE:*` stderr markers, accurate `live_context_fixture_setup_timeout` vs teardown classification.
