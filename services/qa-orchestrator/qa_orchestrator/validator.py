from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from qa_orchestrator.gt_eval import evaluate_gt_expectations, goal_matches_gt
from qa_orchestrator.flow_intent import flow_id_from_test_case_id
from qa_orchestrator.kb_rag import KbRag
from qa_orchestrator.models import (
    DiscoveryResult,
    ExecutionPlan,
    ExecutionResult,
    IntentClassification,
    PlanningResult,
    SuiteSelectionPlan,
    ValidationFinding,
    ValidationResult,
)


class Validator:
    """Phase A: technical rules + honest NEEDS_REVIEW pre-GT. Phase B: GT compare when approved."""

    def __init__(self, kb: KbRag | Any, *, gt_dir: str | Path | None = None) -> None:
        self.kb = kb
        self.gt_dir = Path(gt_dir) if gt_dir else None
        self._approved_gt = self._load_approved_gt()

    def validate(
        self,
        *,
        goal: str,
        run_type: str,
        plan: ExecutionPlan,
        execution: ExecutionResult,
        llm_summary: str = "",
        intent: IntentClassification | None = None,
        suite_plan: SuiteSelectionPlan | None = None,
        discovery: DiscoveryResult | None = None,
        diagnostic_context: dict[str, Any] | None = None,
    ) -> ValidationResult:
        self._approved_gt = self._load_approved_gt()
        ctx = dict(diagnostic_context or {})
        matched_gt = self._matching_gt(
            goal,
            intent=intent,
            suite_plan=suite_plan,
            diagnostic_context=ctx,
        )
        if matched_gt:
            result = self._validate_phase_b(goal, plan, execution, matched_gt, diagnostic_context=ctx)
            return result
        return self._validate_phase_a(
            goal,
            run_type,
            plan,
            execution,
            llm_summary,
            intent=intent,
            suite_plan=suite_plan,
            discovery=discovery,
            diagnostic_context=ctx,
        )

    def _validate_phase_a(
        self,
        goal: str,
        run_type: str,
        plan: ExecutionPlan,
        execution: ExecutionResult,
        llm_summary: str,
        *,
        intent: IntentClassification | None = None,
        suite_plan: SuiteSelectionPlan | None = None,
        discovery: DiscoveryResult | None = None,
        diagnostic_context: dict[str, Any] | None = None,
    ) -> ValidationResult:
        from qa_orchestrator.decision_diagnostics import build_validation_phase_a_diagnostic

        findings: list[ValidationFinding] = []

        if execution.mode != "skipped" and not execution.ok:
            findings.append(
                ValidationFinding(
                    code="execution.failed",
                    severity="error",
                    message=execution.error or "Playwright suite execution failed",
                )
            )
        failed_steps = [o for o in execution.observations if not o.ok]
        for obs in failed_steps:
            findings.append(
                ValidationFinding(
                    code="step.failed",
                    severity="error",
                    message=f"Suite {obs.step_index} ({obs.action}): {obs.message}",
                )
            )

        if execution.mode == "mock":
            findings.append(
                ValidationFinding(
                    code="execution.mock",
                    severity="warn",
                    message="OpenClaw mock mode — production path uses Playwright (QA_RUNNER=playwright)",
                )
            )

        if execution.mode.startswith("playwright_dry_run"):
            findings.append(
                ValidationFinding(
                    code="execution.dry_run",
                    severity="info",
                    message="Playwright dry-run — suite commands validated without live npm execution",
                )
            )

        if suite_plan and not suite_plan.commands and execution.mode != "skipped":
            findings.append(ValidationFinding(code="suite.empty", severity="error", message="No suite commands selected"))

        if suite_plan and suite_plan.blocked_flows:
            for gate in suite_plan.execution_gates:
                if gate.executable:
                    continue
                findings.append(
                    ValidationFinding(
                        code=gate.reason_code,
                        severity="warn",
                        message=gate.message,
                    )
                )
            if suite_plan.flow_ids:
                findings.append(
                    ValidationFinding(
                        code="gate.partial_block",
                        severity="info",
                        message=(
                            f"{len(suite_plan.blocked_flows)} flow(s) blocked; "
                            f"{len(suite_plan.flow_ids)} executable"
                        ),
                    )
                )
            elif execution.mode != "skipped":
                findings.append(
                    ValidationFinding(
                        code="gate.no_executable_flows",
                        severity="error",
                        message=(
                            "All candidate flows blocked by execution gate "
                            "(requires APPROVED artifact + sme_ready + KB safety)"
                        ),
                    )
                )

        if intent and intent.execution_mode == "morning_sanity" and suite_plan:
            if suite_plan.suite_ids != ["SUITE-SANITY-MORNING"] and "SUITE-SANITY-MORNING" not in suite_plan.suite_ids:
                findings.append(
                    ValidationFinding(
                        code="sanity.suite_mismatch",
                        severity="warn",
                        message="Morning sanity should target SUITE-SANITY-MORNING",
                    )
                )

        if discovery and intent and intent.execution_mode in {"new_feature", "discover"}:
            findings.append(
                ValidationFinding(
                    code="discovery.completed",
                    severity="info",
                    message=f"Discovery crawl ({discovery.mode}): {discovery.pages_crawled} pages",
                )
            )
            for suggestion in discovery.suggestions[:3]:
                findings.append(
                    ValidationFinding(code="discovery.suggestion", severity="info", message=suggestion)
                )

        errors = [f for f in findings if f.severity == "error"]
        if errors:
            result = ValidationResult(
                phase="A",
                conclusion="FAIL",
                reason_code="validator.technical_failure",
                summary="Technical execution failure before business validation",
                findings=findings,
            )
            result.decision_diagnostics = build_validation_phase_a_diagnostic(
                run_id=diagnostic_context.get("run_id") if diagnostic_context else None,
                validation=result,
                goal=goal,
                execution=execution,
                intent=intent,
                suite_plan=suite_plan,
                planning=diagnostic_context.get("planning") if diagnostic_context else None,
                state=diagnostic_context.get("state") if diagnostic_context else None,
                gate=diagnostic_context.get("gate") if diagnostic_context else None,
                approved_gt_available=False,
                skip_execution=diagnostic_context.get("skip_execution") if diagnostic_context else None,
            )
            return result

        mode_label = intent.execution_mode if intent else run_type
        narrative = llm_summary or plan.summary
        summary = (
            f"Phase A ({mode_label}): {narrative}. "
            "Business outcome requires SME Ground Truth approval for PASS."
        )
        result = ValidationResult(
            phase="A",
            conclusion="NEEDS_REVIEW",
            reason_code="validator.pre_gt_honest",
            summary=summary,
            findings=findings,
        )
        approved_match = self._matching_gt(
            goal,
            intent=intent,
            suite_plan=suite_plan,
            diagnostic_context=diagnostic_context,
        )
        result.decision_diagnostics = build_validation_phase_a_diagnostic(
            run_id=diagnostic_context.get("run_id") if diagnostic_context else None,
            validation=result,
            goal=goal,
            execution=execution,
            intent=intent,
            suite_plan=suite_plan,
            planning=diagnostic_context.get("planning") if diagnostic_context else None,
            state=diagnostic_context.get("state") if diagnostic_context else None,
            gate=diagnostic_context.get("gate") if diagnostic_context else None,
            approved_gt_available=approved_match is not None,
            matched_for_goal=approved_match is not None,
            skip_execution=diagnostic_context.get("skip_execution") if diagnostic_context else None,
        )
        return result

    def _validate_phase_b(
        self,
        goal: str,
        plan: ExecutionPlan,
        execution: ExecutionResult,
        matched_gt: tuple[str, dict[str, Any]],
        *,
        diagnostic_context: dict[str, Any] | None = None,
    ) -> ValidationResult:
        from qa_orchestrator.decision_diagnostics import build_validation_phase_b_diagnostic

        gt_id, fact = matched_gt
        findings: list[ValidationFinding] = []
        meta_list = [o.meta or {} for o in execution.observations if o.meta]

        executed_tc = _executed_test_case_ids(diagnostic_context)
        if executed_tc:
            for tc in executed_tc:
                flow_from_tc = flow_id_from_test_case_id(tc)
                gt_flow = str(fact.get("flow_id") or "")
                if flow_from_tc and gt_flow and flow_from_tc != gt_flow:
                    result = ValidationResult(
                        phase="B",
                        conclusion="FAIL",
                        reason_code="validator.gt_flow_mismatch",
                        summary=(
                            f"Executed test {tc} ({flow_from_tc}) cannot satisfy GT for {gt_flow}"
                        ),
                        findings=[
                            ValidationFinding(
                                code="gt.flow_mismatch",
                                severity="error",
                                message=f"execution={flow_from_tc} gt={gt_flow}",
                            )
                        ],
                        gt_refs=[gt_id],
                    )
                    result.decision_diagnostics = build_validation_phase_b_diagnostic(
                        run_id=diagnostic_context.get("run_id") if diagnostic_context else None,
                        validation=result,
                        gt_id=gt_id,
                        state=diagnostic_context.get("state") if diagnostic_context else None,
                        execution=execution,
                    )
                    return result

        passed, failures = evaluate_gt_expectations(fact, execution.ok, meta_list)
        if not passed:
            result = ValidationResult(
                phase="B",
                conclusion="FAIL",
                reason_code="validator.gt_expectation_failed",
                summary=f"Approved GT {gt_id} expectations not met: {'; '.join(failures)}",
                findings=[
                    ValidationFinding(code="gt.expectation_failed", severity="error", message=f)
                    for f in failures
                ],
                gt_refs=[gt_id],
            )
            result.decision_diagnostics = build_validation_phase_b_diagnostic(
                run_id=diagnostic_context.get("run_id") if diagnostic_context else None,
                validation=result,
                gt_id=gt_id,
                state=diagnostic_context.get("state") if diagnostic_context else None,
                execution=execution,
            )
            return result

        result = ValidationResult(
            phase="B",
            conclusion="PASS",
            reason_code="validator.gt_match",
            summary="Approved GT expectations satisfied by structured execution results",
            findings=findings,
            gt_refs=[gt_id],
        )
        result.decision_diagnostics = build_validation_phase_b_diagnostic(
            run_id=diagnostic_context.get("run_id") if diagnostic_context else None,
            validation=result,
            gt_id=gt_id,
            state=diagnostic_context.get("state") if diagnostic_context else None,
            execution=execution,
        )
        return result

    def _load_approved_gt(self) -> dict[str, dict[str, Any]]:
        if not self.gt_dir or not self.gt_dir.exists():
            return {}
        approved: dict[str, dict[str, Any]] = {}
        for path in self.gt_dir.glob("*.json"):
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if doc.get("status") == "approved":
                approved[path.stem] = doc
        return approved

    def _matching_gt(
        self,
        goal: str,
        *,
        intent: IntentClassification | None = None,
        suite_plan: SuiteSelectionPlan | None = None,
        diagnostic_context: dict[str, Any] | None = None,
    ) -> tuple[str, dict[str, Any]] | None:
        primary: str | None = None
        if suite_plan:
            primary = suite_plan.primary_executable_flow_id or (
                suite_plan.flow_ids[0] if suite_plan.flow_ids else None
            )
        elif intent and intent.flow_ids:
            primary = intent.flow_ids[0]
        executed_tc = _executed_test_case_ids(diagnostic_context)
        for gid, fact in self._approved_gt.items():
            if goal_matches_gt(
                goal,
                fact,
                primary_flow_id=primary,
                executed_test_case_ids=executed_tc or None,
            ):
                return gid, fact
        return None


def _executed_test_case_ids(diagnostic_context: dict[str, Any] | None) -> list[str]:
    if not diagnostic_context:
        return []
    from qa_orchestrator.decision_diagnostics import _selected_test_case_ids

    state = diagnostic_context.get("state")
    if state is None:
        return []
    return _selected_test_case_ids(state)
