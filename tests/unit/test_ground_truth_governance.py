"""Ground Truth governance and Phase B regression tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qa_orchestrator.agent_models import AgentRunState
from qa_orchestrator.decision_diagnostics import build_validation_phase_a_diagnostic
from qa_orchestrator.gt_eval import (
    evaluate_gt_expectations,
    goal_matches_gt,
    parse_executed_test_case_ids,
)
from qa_orchestrator.kb_rag import KbRag
from qa_orchestrator.models import (
    ExecutionPlan,
    ExecutionResult,
    PlanStep,
    StepObservation,
    SuiteSelectionPlan,
    ValidationResult,
)
from qa_orchestrator.validator import Validator

REPO = Path(__file__).resolve().parents[2]
DISCOVERY_ROOT = REPO / "data" / "discovery-kb"


def _obs(*, ok: bool = True, expected: int = 1, param_trace: dict | None = None) -> ExecutionResult:
    meta = {"playwright_report": {"stats": {"expected": expected}}}
    if param_trace:
        meta["param_trace"] = param_trace
    return ExecutionResult(
        ok=ok,
        mode="playwright",
        observations=[
            StepObservation(step_index=0, action="playwright_suite", ok=ok, meta=meta),
        ],
    )


def test_a_no_approved_gt_needs_review():
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=f"{DISCOVERY_ROOT}/gt")
    plan = ExecutionPlan(goal="Search SKU ABC123 in product search", steps=[PlanStep(action="custom", target="suite")])
    execution = _obs(param_trace={"product_search_result_verified": "true"})
    v = validator.validate(goal=plan.goal, run_type="adhoc", plan=plan, execution=execution)
    assert v.phase == "A"
    assert v.conclusion == "NEEDS_REVIEW"
    assert v.reason_code == "validator.pre_gt_honest"


def test_b_approved_matching_gt_passes(tmp_path: Path):
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    fact = {
        "id": "gt-bf-product-003-positive",
        "status": "approved",
        "subject": "product search",
        "tags": ["BF-PRODUCT-003", "search sku"],
        "expectations": {
            "execution_ok": True,
            "min_passed_tests": 1,
            "require_product_search_verified": True,
        },
    }
    (gt_dir / "gt-bf-product-003-positive.json").write_text(json.dumps(fact), encoding="utf-8")
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=gt_dir)
    goal = "Search SKU 552811DUDABA00"
    plan = ExecutionPlan(goal=goal, steps=[])
    execution = _obs(param_trace={"product_search_result_verified": "true"})
    state = AgentRunState(
        run_id="run-gt",
        request=goal,
        metadata={"executed_test_case_ids": ["TC-BF-PRODUCT-003-P01"]},
    )
    v = validator.validate(
        goal=goal,
        run_type="adhoc",
        plan=plan,
        execution=execution,
        diagnostic_context={"run_id": "run-gt", "state": state},
    )
    assert v.phase == "B"
    assert v.conclusion == "PASS"
    assert v.decision_diagnostics["selected_test_case_ids"] == ["TC-BF-PRODUCT-003-P01"]


def test_c_non_matching_approved_gt_stays_phase_a():
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=f"{DISCOVERY_ROOT}/gt")
    goal = "Search SKU 552811DUDABA00"
    plan = ExecutionPlan(goal=goal, steps=[])
    execution = _obs()
    v = validator.validate(goal=goal, run_type="adhoc", plan=plan, execution=execution)
    assert v.conclusion == "NEEDS_REVIEW"
    assert v.phase == "A"


def test_c_approved_gt_expectation_mismatch_fails(tmp_path: Path):
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    fact = {
        "id": "gt-bf-product-003-positive",
        "status": "approved",
        "subject": "product search",
        "tags": ["BF-PRODUCT-003", "search sku"],
        "expectations": {
            "execution_ok": True,
            "min_passed_tests": 5,
            "require_product_search_verified": True,
        },
    }
    (gt_dir / "gt-bf-product-003-positive.json").write_text(json.dumps(fact), encoding="utf-8")
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=gt_dir)
    goal = "Search SKU 552811DUDABA00"
    v = validator.validate(
        goal=goal,
        run_type="adhoc",
        plan=ExecutionPlan(goal=goal, steps=[]),
        execution=_obs(expected=1, param_trace={"product_search_result_verified": "true"}),
    )
    assert v.phase == "B"
    assert v.conclusion == "FAIL"
    assert v.reason_code == "validator.gt_expectation_failed"


def test_d_execution_failure_with_approved_gt_not_pass(tmp_path: Path):
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    fact = {
        "id": "gt-bf-product-003-positive",
        "status": "approved",
        "subject": "product search",
        "tags": ["BF-PRODUCT-003", "search sku", "sku"],
        "expectations": {"execution_ok": True, "min_passed_tests": 1},
    }
    (gt_dir / "gt-bf-product-003-positive.json").write_text(json.dumps(fact), encoding="utf-8")
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=gt_dir)
    goal = "Search SKU 552811DUDABA00"
    v = validator.validate(
        goal=goal,
        run_type="adhoc",
        plan=ExecutionPlan(goal=goal, steps=[]),
        execution=_obs(ok=False, expected=0),
    )
    assert v.phase == "B"
    assert v.conclusion == "FAIL"


def test_e_gt_approval_is_file_governance_only():
    path = DISCOVERY_ROOT / "gt" / "gt-bf-product-003-positive.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert doc.get("status") == "pending_sme_approval"
    assert doc.get("approval", {}).get("state") == "pending_sme_approval"


def test_draft_gt_not_loaded_for_phase_b():
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=f"{DISCOVERY_ROOT}/gt")
    draft_path = DISCOVERY_ROOT / "gt" / "gt-bf-product-003-positive.json"
    assert draft_path.exists()
    doc = json.loads(draft_path.read_text(encoding="utf-8"))
    assert doc.get("status") != "approved"
    assert "gt-bf-product-003-positive" not in validator._approved_gt


def test_goal_matches_product_search_gt():
    fact = json.loads((DISCOVERY_ROOT / "gt" / "gt-bf-product-003-positive.json").read_text(encoding="utf-8"))
    assert goal_matches_gt("Search SKU 552811DUDABA00", fact, primary_flow_id="BF-PRODUCT-003")


def test_goal_does_not_match_view_product_with_search_gt():
    fact = json.loads((DISCOVERY_ROOT / "gt" / "gt-bf-product-003-positive.json").read_text(encoding="utf-8"))
    assert not goal_matches_gt(
        "View product using SKU 552811DUDABA00",
        fact,
        primary_flow_id="BF-PRODUCT-004",
    )


def test_parse_executed_test_case_ids_from_report():
    report = {
        "suites": [
            {
                "specs": [
                    {
                        "title": "TC-BF-PRODUCT-003-P01 direct product search",
                        "tests": [{"title": "passes"}],
                    }
                ]
            }
        ]
    }
    assert parse_executed_test_case_ids(report) == ["TC-BF-PRODUCT-003-P01"]


def test_phase_a_diagnostic_selected_test_case_ids_from_state():
    state = AgentRunState(
        run_id="r1",
        request="Search SKU",
        metadata={"executed_test_case_ids": ["TC-BF-PRODUCT-003-P01"]},
    )
    diag = build_validation_phase_a_diagnostic(
        run_id="r1",
        validation=ValidationResult(phase="A", conclusion="NEEDS_REVIEW", reason_code="validator.pre_gt_honest", summary="x"),
        goal="g",
        execution=ExecutionResult(ok=True, mode="playwright", observations=[]),
        state=state,
    )
    assert diag["selected_test_case_ids"] == ["TC-BF-PRODUCT-003-P01"]


def _home_gt_approved(tmp_path: Path) -> Path:
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    doc = {
        "id": "gt-bf-home-010-01-positive",
        "status": "approved",
        "subject": "item search",
        "flow_id": "BF-HOME-010-01",
        "test_case_id": "TC-BF-HOME-010-01-P01",
        "tags": ["BF-HOME-010-01", "item search", "TC-BF-HOME-010-01-P01"],
        "expectations": {
            "execution_ok": True,
            "min_passed_tests": 1,
            "require_product_search_verified": True,
        },
    }
    path = gt_dir / "gt-bf-home-010-01-positive.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    return gt_dir


def test_approved_home_gt_runs_phase_b_when_executed_tc_matches_despite_product_primary(tmp_path: Path):
    gt_dir = _home_gt_approved(tmp_path)
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=gt_dir)
    goal = "BF-HOME-010-01 — Item Search using SKU 552811DUDABA00"
    suite = SuiteSelectionPlan(
        flow_ids=["BF-HOME-010-01", "BF-PRODUCT-003"],
        primary_executable_flow_id="BF-PRODUCT-003",
        commands=["npx playwright test"],
    )
    state = AgentRunState(
        run_id="run_7on3pn3amh77",
        request=goal,
        metadata={"executed_test_case_ids": ["TC-BF-HOME-010-01-P01"]},
    )
    execution = _obs(param_trace={"product_search_result_verified": "true"})
    result = validator.validate(
        goal=goal,
        run_type="adhoc",
        plan=ExecutionPlan(goal=goal, steps=[]),
        execution=execution,
        suite_plan=suite,
        diagnostic_context={"run_id": "run_7on3pn3amh77", "state": state},
    )
    assert result.phase == "B"
    assert result.conclusion == "PASS"
    assert result.reason_code == "validator.gt_match"
    assert result.reason_code != "validator.pre_gt_honest"


def test_validator_reloads_approved_gt_without_process_restart(tmp_path: Path):
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=gt_dir)
    goal = "BF-HOME-010-01 — Item Search using SKU 552811DUDABA00"
    suite = SuiteSelectionPlan(
        flow_ids=["BF-HOME-010-01"],
        primary_executable_flow_id="BF-HOME-010-01",
        commands=["npx playwright test"],
    )
    state = AgentRunState(
        run_id="run_reload",
        request=goal,
        metadata={"executed_test_case_ids": ["TC-BF-HOME-010-01-P01"]},
    )
    execution = _obs(param_trace={"product_search_result_verified": "true"})
    ctx = {"run_id": "run_reload", "state": state}

    before = validator.validate(
        goal=goal,
        run_type="adhoc",
        plan=ExecutionPlan(goal=goal, steps=[]),
        execution=execution,
        suite_plan=suite,
        diagnostic_context=ctx,
    )
    assert before.phase == "A"
    assert before.reason_code == "validator.pre_gt_honest"

    (gt_dir / "gt-bf-home-010-01-positive.json").write_text(
        json.dumps(
            {
                "id": "gt-bf-home-010-01-positive",
                "status": "approved",
                "flow_id": "BF-HOME-010-01",
                "test_case_id": "TC-BF-HOME-010-01-P01",
                "tags": ["BF-HOME-010-01", "item search"],
                "expectations": {
                    "execution_ok": True,
                    "min_passed_tests": 1,
                    "require_product_search_verified": True,
                },
            }
        ),
        encoding="utf-8",
    )

    after = validator.validate(
        goal=goal,
        run_type="adhoc",
        plan=ExecutionPlan(goal=goal, steps=[]),
        execution=execution,
        suite_plan=suite,
        diagnostic_context=ctx,
    )
    assert after.phase == "B"
    assert after.conclusion == "PASS"


def test_phase_a_diagnostics_do_not_loosely_claim_gt_match_when_context_mismatches(tmp_path: Path):
    gt_dir = _home_gt_approved(tmp_path)
    kb = KbRag(f"{DISCOVERY_ROOT}/kb")
    validator = Validator(kb, gt_dir=gt_dir)
    goal = "BF-HOME-010-01 — Item Search using SKU 552811DUDABA00"
    suite = SuiteSelectionPlan(
        flow_ids=["BF-PRODUCT-003"],
        primary_executable_flow_id="BF-PRODUCT-003",
        commands=["npx playwright test"],
    )
    result = validator.validate(
        goal=goal,
        run_type="adhoc",
        plan=ExecutionPlan(goal=goal, steps=[]),
        execution=_obs(param_trace={"product_search_result_verified": "true"}),
        suite_plan=suite,
        diagnostic_context={"run_id": "run_diag", "state": AgentRunState(run_id="run_diag", request=goal)},
    )
    assert result.phase == "A"
    assert result.reason_code == "validator.pre_gt_honest"
    gt_diag = result.decision_diagnostics["ground_truth"]
    assert gt_diag["approved_available"] is False
    assert gt_diag["matched_for_goal"] is False
