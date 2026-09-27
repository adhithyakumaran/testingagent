"""Explicit canonical BF-* ids in user goals must win over semantic product routing."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from qa_orchestrator.flow_intent import FLOW_SEARCH_PRODUCT, extract_explicit_flow_ids
from qa_orchestrator.flow_resolver import FlowResolver
from qa_orchestrator.intent_classifier import IntentClassifier
from qa_orchestrator.knowledge_graph import FlowKnowledgeGraph
from qa_orchestrator.llm_client import PlannerLlmClient
from qa_orchestrator.qa_planner import QaPlanner
from qa_orchestrator.suite_commands import build_flow_command
from qa_orchestrator.suite_selector import SuiteSelector

REPO = Path(__file__).resolve().parents[2]
DISCOVERY = REPO / "data" / "discovery-kb"
AUTOMATION = REPO / "apps" / "automation"
HOME_SPEC = AUTOMATION / "tests" / "home" / "BF-HOME-010-01.spec.ts"


@pytest.fixture(scope="module")
def graph() -> FlowKnowledgeGraph:
    return FlowKnowledgeGraph(discovery_root=str(DISCOVERY))


def test_extract_explicit_flow_ids_preserves_order():
    goal = "Run BF-HOME-010-01 Item Search using SKU 552811DUDABA00"
    assert extract_explicit_flow_ids(goal) == ["BF-HOME-010-01"]


def test_explicit_bf_home_010_01_becomes_primary(graph: FlowKnowledgeGraph) -> None:
    goal = "Run BF-HOME-010-01 Item Search using SKU 552811DUDABA00"
    intent = IntentClassifier(graph, PlannerLlmClient(enabled=False)).classify(goal)
    assert intent.flow_ids == ["BF-HOME-010-01"]
    assert intent.flow_ids[0] != FLOW_SEARCH_PRODUCT
    assert FLOW_SEARCH_PRODUCT in intent.supporting_flow_ids
    plan = QaPlanner(graph, PlannerLlmClient(enabled=False)).plan(intent)
    assert plan.intent.flow_ids == ["BF-HOME-010-01"]
    res = FlowResolver(graph, PlannerLlmClient(enabled=False)).resolve(goal, intent_flow_ids=intent.flow_ids)
    assert res.primary_flow_id == "BF-HOME-010-01"
    suite = SuiteSelector(graph).select(plan.intent)
    assert suite.primary_executable_flow_id == "BF-HOME-010-01"
    assert suite.commands == [build_flow_command("BF-HOME-010-01", polarity="positive")]


def test_explicit_bf_product_003_still_primary(graph: FlowKnowledgeGraph) -> None:
    goal = "Run BF-PRODUCT-003 search SKU 552811DUDABA00"
    intent = IntentClassifier(graph, PlannerLlmClient(enabled=False)).classify(goal)
    assert intent.flow_ids == [FLOW_SEARCH_PRODUCT]
    suite = SuiteSelector(graph).select(intent)
    assert suite.primary_executable_flow_id == FLOW_SEARCH_PRODUCT


def test_semantic_search_sku_without_flow_id_routes_to_bf_product_003(graph: FlowKnowledgeGraph) -> None:
    goal = "Search SKU 552811DUDABA00"
    intent = IntentClassifier(graph, PlannerLlmClient(enabled=False)).classify(goal)
    assert intent.flow_ids == [FLOW_SEARCH_PRODUCT]
    res = FlowResolver(graph, PlannerLlmClient(enabled=False)).resolve(goal, intent_flow_ids=intent.flow_ids)
    assert res.primary_flow_id == FLOW_SEARCH_PRODUCT


def _node_grep(flow_id: str) -> str:
    script = (
        "import { buildFlowGrep } from './scripts/run-flow-grep.mjs';"
        f"console.log(buildFlowGrep('positive', {flow_id!r}));"
    )
    return subprocess.check_output(
        ["node", "--input-type=module", "-e", script],
        cwd=AUTOMATION,
        text=True,
    ).strip()


def _grep_matches(grep: str, haystack: str) -> bool:
    return re.search(grep, haystack) is not None


def test_bf_home_010_01_positive_grep_selects_one_test():
    grep = _node_grep("BF-HOME-010-01")
    text = HOME_SPEC.read_text(encoding="utf-8")
    describe = re.search(r"test\.describe\('([^']+)'", text)
    tests = re.findall(r"test\('([^']+)'", text)
    assert describe is not None
    haystacks = [f"{describe.group(1)} {t}" for t in tests]
    matched = [h for h in haystacks if _grep_matches(grep, h)]
    assert len(matched) == 1
    assert "TC-BF-HOME-010-01-P01" in matched[0]


def test_playwright_lists_bf_home_010_01_positive_test():
    grep = _node_grep("BF-HOME-010-01")
    proc = subprocess.run(
        ["npx", "playwright", "test", "--grep", grep, "--list"],
        cwd=AUTOMATION,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert "TC-BF-HOME-010-01-P01" in proc.stdout
    assert "No tests found" not in proc.stdout
