# ScoutAI — Enterprise QA Agent

Deterministic-first agent runtime + **ScoutAI** orchestrator for Oracle APEX Endless Aisle UAT.

> **Canonical repo:** https://github.com/adhithyakumaran/testingagent  
> **Repo layout v2:** See [docs/REPO_LAYOUT.md](docs/REPO_LAYOUT.md) for the enterprise folder structure.

## Quick start (local)

**Python 3.10+** and **Node 20+** required. On Windows use `python` not `python3`.

```bash
# One command — backend + ScoutAI console
./scripts/start_local_stack.sh
```

Open **http://127.0.0.1:43123**

### Two terminals (Windows Git Bash)

**Terminal 1 — backend** (repo root `baseagentmain/`):

```bash
cd ~/Downloads/baseagentmain
set -a && source .env && set +a
export PYTHONPATH=services/agent-runtime:services/qa-orchestrator:.
export QA_DISCOVERY_ROOT=data/discovery-kb
export QA_AUTOMATION_DIR=apps/automation
export QA_RUNNER=playwright
python scripts/local_agent_server.py --port 43124
```

**Terminal 2 — frontend** (`apps/console/`):

```bash
cd ~/Downloads/baseagentmain/apps/console
npm install
export LOCAL_AGENT_URL=http://127.0.0.1:43124
npm run dev
```

### Playwright sanity (19 flows)

```bash
cd apps/automation
npm run test:sanity
npm run test:regression    # full regression
npm run test:negative      # negative / edge cases
```

Credentials: `apps/automation/config/.env`

## Enterprise repo map

| Path | Purpose |
|---|---|
| `apps/console/` | ScoutAI Next.js UI |
| `apps/automation/` | Playwright tests + scenarios/cases/suites |
| `services/agent-runtime/` | Base Agent kernel |
| `services/qa-orchestrator/` | LLM classify → suite select → run → report |
| `data/discovery-kb/` | Flow KB YAML, recordings, crawl snapshots |
| `plugins/qa_apex/` | Crawler + APEX skills |
| `docs/` | Architecture & proposals |
| `infra/` | Deploy + CI |

## Scenarios location

```text
apps/automation/test-design/flows/{BF-*}/scenarios.yaml
apps/automation/test-design/flows/{BF-*}/test-cases.yaml
data/discovery-kb/flows/{BF-*}.yaml          ← KB source
```

## Orchestrator modes (NL → suites)

| Ask | Mode | Runs |
|---|---|---|
| "morning sanity" | `morning_sanity` | All 19 @sanity suites |
| "sanity for login" | `adhoc_existing` | BF-LOGIN-001 suite |
| "full regression" | `regression_suite` | All @regression |
| "negative login test" | `negative_suite` | @negative tagged tests |
| "test payment flow" | `incident_multi_flow` | Billing + related flows (synonym map) |

See [docs/REPO_LAYOUT.md](docs/REPO_LAYOUT.md) · [docs/architecture/QA_ORCHESTRATOR.md](docs/architecture/QA_ORCHESTRATOR.md)
