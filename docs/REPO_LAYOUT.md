# Enterprise Repository Layout

**Version:** 2.0 · **Date:** September 2026

This repo was reorganized for ScoutAI enterprise delivery. Nothing was deleted — paths moved.

## Canonical structure

```text
Base_agent/
├── apps/
│   ├── console/              ← ScoutAI Next.js UI (was qa-console/)
│   └── automation/           ← Playwright suites + test-design (was automation/)
├── services/
│   ├── agent-runtime/        ← Base Agent kernel (was src/base_agent/)
│   └── qa-orchestrator/      ← Intent → suite → run → report (was src/qa_orchestrator/)
├── plugins/
│   ├── qa_apex/              ← Crawler, APEX skills, rules
│   └── mock_demo/
├── data/
│   └── discovery-kb/         ← Flow KB, recordings, crawl snapshots (was discovery/uat_ea/)
├── infra/
│   ├── deploy/               ← Dockerfile
│   └── ci/                   ← azure-pipelines.yml
├── docs/                     ← Architecture, proposals, meeting notes
├── tests/                    ← Python unit tests for agent/orchestrator
├── scripts/                  ← local_agent_server, browser_recorder, setup
├── repo_paths.py             ← Central path resolution + legacy fallbacks
└── uploads/                  ← Client requirement PDFs (reference only)
```

## Path migration map

| Old path | New path |
|---|---|
| `qa-console/` | `apps/console/` |
| `automation/` | `apps/automation/` |
| `src/base_agent/` | `services/agent-runtime/base_agent/` |
| `src/qa_orchestrator/` | `services/qa-orchestrator/qa_orchestrator/` |
| `discovery/uat_ea/` | `data/discovery-kb/` |
| `deploy/` | `infra/deploy/` |
| `azure-pipelines.yml` | `infra/ci/azure-pipelines.yml` |

## Environment defaults

```bash
export QA_DISCOVERY_ROOT=data/discovery-kb
export QA_AUTOMATION_DIR=apps/automation
export PYTHONPATH=services/agent-runtime:services/qa-orchestrator:.
```

## Artifact chain (unchanged logic)

```text
data/discovery-kb/flows/           ← KB source of truth
apps/automation/test-design/       ← scenarios → cases → suites
apps/automation/tests/             ← Playwright specs
apps/automation/suites/            ← sanity / regression manifests
```

## New enterprise capabilities (v2)

| Feature | Location |
|---|---|
| Scheduled crawl (post-deploy / cron) | `scripts/scheduled_crawl.py` |
| KB-priority crawl seeds | `plugins/qa_apex/crawler/seeds.py` |
| Crawl snapshot diffing | `plugins/qa_apex/crawler/persistence.py` → `data/discovery-kb/crawl_snapshots/` |
| Capability synonyms (payment→billing) | `data/discovery-kb/capability_synonyms.yaml` |
| Regression / negative suite modes | `services/qa-orchestrator/qa_orchestrator/suite_selector.py` |
| Browser recorder (clicks + live feed) | `scripts/browser_recorder.py` + console panel |
| SME approval queue UI | `apps/console/app/api/approval/` |
| Coverage dashboard | `apps/console/app/api/coverage/` |
