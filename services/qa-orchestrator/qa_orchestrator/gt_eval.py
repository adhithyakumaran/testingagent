"""Ground Truth helpers for Phase B validation."""

from __future__ import annotations

import re
from typing import Any

from qa_orchestrator.flow_intent import (
    FLOW_SEARCH_PRODUCT,
    FLOW_VIEW_PRODUCT,
    extract_sku,
    flow_id_from_test_case_id,
    resolve_product_intent_kind,
)

_TC_ID_RE = re.compile(r"TC-BF-[A-Z0-9-]+(?:-[A-Z0-9]+)*")

_PARAM_ONLY_TAGS = frozenset({"sku", "itemcode", "item_code"})


def goal_matches_gt(
    goal: str,
    fact: dict[str, Any],
    *,
    primary_flow_id: str | None = None,
    executed_test_case_ids: list[str] | None = None,
) -> bool:
    gt_flow = str(fact.get("flow_id") or "").strip()
    exec_flows: set[str] = set()
    if executed_test_case_ids:
        exec_flows = {f for f in (flow_id_from_test_case_id(tc) for tc in executed_test_case_ids) if f}

    if primary_flow_id and gt_flow and gt_flow != primary_flow_id:
        # Executable flow on disk (e.g. BF-HOME-010-01) may differ from planner primary (e.g. BF-PRODUCT-003).
        if not (exec_flows and gt_flow in exec_flows):
            return False

    if executed_test_case_ids and gt_flow:
        if exec_flows and gt_flow not in exec_flows:
            return False

    bound_tc = str(fact.get("test_case_id") or "").strip()
    if bound_tc and executed_test_case_ids and bound_tc in executed_test_case_ids:
        return True

    kind = resolve_product_intent_kind(goal)
    if kind == "view_product" and gt_flow == FLOW_SEARCH_PRODUCT:
        return False
    if kind == "search_product" and gt_flow == FLOW_VIEW_PRODUCT:
        return False

    g = goal.lower()
    if gt_flow == FLOW_SEARCH_PRODUCT and any(
        p in g for p in ("view product", "product detail", "product details", "open product")
    ):
        return False

    if gt_flow and gt_flow.lower() in g:
        return True

    subject = str(fact.get("subject") or "").strip().lower()
    if subject and subject in g:
        return True

    for tag in fact.get("tags") or []:
        t = str(tag).strip()
        if not t:
            continue
        tl = t.lower()
        if tl in _PARAM_ONLY_TAGS:
            continue
        if tl.startswith("tc-bf-"):
            continue
        if len(tl) < 4 and not tl.startswith("bf-"):
            continue
        if tl in g:
            return True

    if kind == "search_product" and gt_flow == FLOW_SEARCH_PRODUCT and extract_sku(goal):
        return True

    return False


def evaluate_gt_expectations(
    fact: dict[str, Any],
    execution_ok: bool,
    observation_meta: list[dict[str, Any]],
) -> tuple[bool, list[str]]:
    """Return (passed, failure_reasons) from structured GT expectations only."""
    expectations = fact.get("expectations") or {}
    failures: list[str] = []

    if expectations.get("execution_ok") is True and not execution_ok:
        failures.append("execution_ok expected true")

    min_passed = expectations.get("min_passed_tests")
    if isinstance(min_passed, int) and min_passed > 0:
        passed = _count_passed_tests(observation_meta)
        if passed < min_passed:
            failures.append(f"min_passed_tests expected >= {min_passed}, got {passed}")

    if expectations.get("require_product_search_verified") is True:
        if not _product_search_verified(observation_meta):
            failures.append("product_search result_verified trace missing (PRODUCT_SEARCH_TRACE / param_trace)")

    return (len(failures) == 0, failures)


def _product_search_verified(observation_meta: list[dict[str, Any]]) -> bool:
    for meta in observation_meta:
        trace = meta.get("param_trace") or {}
        if trace.get("product_search_result_verified") == "true":
            return True
    return False


def _count_passed_tests(observation_meta: list[dict[str, Any]]) -> int:
    total = 0
    for meta in observation_meta:
        report = meta.get("playwright_report") or {}
        stats = report.get("stats") or {}
        expected = stats.get("expected")
        if isinstance(expected, int):
            total += expected
    return total


def parse_executed_test_case_ids(report_data: dict[str, Any]) -> list[str]:
    """Extract TC-BF-* ids from Playwright JSON report suites."""
    found: list[str] = []

    def walk_suite(suite: dict[str, Any]) -> None:
        for spec in suite.get("specs") or []:
            for test in spec.get("tests") or []:
                title = " ".join(
                    str(x) for x in (test.get("title") or "", spec.get("title") or "") if x
                )
                for match in _TC_ID_RE.finditer(title):
                    found.append(match.group(0))
        for child in suite.get("suites") or []:
            if isinstance(child, dict):
                walk_suite(child)

    for suite in report_data.get("suites") or []:
        if isinstance(suite, dict):
            walk_suite(suite)
    return list(dict.fromkeys(found))


def executed_test_case_ids_from_playwright_report(report_data: dict[str, Any]) -> list[str]:
    """Only return executed TC ids when Playwright stats prove tests ran."""
    stats = report_data.get("stats") or {}
    expected = stats.get("expected")
    if not isinstance(expected, int) or expected <= 0:
        return []
    return parse_executed_test_case_ids(report_data)


def infer_test_case_ids_for_flow(flow_id: str) -> list[str]:
    """Fallback when report JSON lacks titles — primary positive case only."""
    if flow_id == FLOW_SEARCH_PRODUCT:
        return ["TC-BF-PRODUCT-003-P01"]
    if flow_id == FLOW_VIEW_PRODUCT:
        return ["TC-BF-PRODUCT-004-P01"]
    return []
