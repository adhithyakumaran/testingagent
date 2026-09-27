"""P6 — bounded controlled agent execution loop."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from qa_orchestrator.agent_config import AgentConfig
from qa_orchestrator.agent_decision_engine import AgentDecisionEngine
from qa_orchestrator.agent_executor import AgentExecutor
from qa_orchestrator.agent_journal import save_journal
from qa_orchestrator.agent_metrics import metrics_from_single_run
from qa_orchestrator.agent_resume import build_snapshot_from_state
from qa_orchestrator.agent_state_store import save_snapshot
from qa_orchestrator.decision_diagnostics import (
    attach_diagnostic_to_state,
    build_execution_gate_block_diagnostic,
    build_terminal_diagnostic,
    log_decision_block,
)
from qa_orchestrator.agent_models import (
    AgentAction,
    AgentDecisionEntry,
    AgentFailureCategory,
    AgentFailureRecord,
    AgentMetrics,
    AgentRunResult,
    AgentRunState,
)
from qa_orchestrator.agent_policy import PolicyValidator
from qa_orchestrator.failure_classifier import classify_failure
from qa_orchestrator.healing_policy import is_healing_eligible
from qa_orchestrator.models import ExecutionResult, OrchestratorResult, StepObservation
from qa_orchestrator.run_request import RunRequest
from qa_orchestrator.planner import intent_to_execution_plan
from qa_orchestrator.reporter import build_markdown_report

_TERMINAL = frozenset({"COMPLETED", "FAILED", "BLOCKED", "NEEDS_REVIEW", "WAITING_FOR_APPROVAL"})


def _new_run_id(request: RunRequest) -> str:
    return request.run_id or f"agent-{uuid4().hex[:12]}"


def _map_failure_category(failure_type: str) -> AgentFailureCategory:
    mapping: dict[str, AgentFailureCategory] = {
        "LOCATOR": "LOCATOR",
        "TIMING": "TIMING",
        "NAVIGATION": "NAVIGATION",
        "AUTHENTICATION": "AUTHENTICATION",
        "DATA": "DATA",
        "APPLICATION": "APPLICATION",
        "INFRASTRUCTURE": "INFRASTRUCTURE",
        "UNKNOWN": "UNKNOWN",
    }
    return mapping.get(failure_type, "UNKNOWN")


class ControlledAgentLoop:
    """Canonical bounded agent loop: PLAN → ACT → OBSERVE → VERIFY → RECOVER."""

    def __init__(self, orchestrator) -> None:
        self.orchestrator = orchestrator
        self.config = AgentConfig.from_env()
        self.engine = AgentDecisionEngine(self.config, llm_client=getattr(orchestrator, "llm", None))
        self.policy = PolicyValidator()
        self.executor = AgentExecutor(orchestrator)

    def run(self, request: RunRequest | str) -> AgentRunResult:
        req = request if isinstance(request, RunRequest) else RunRequest(goal=request)
        started = time.perf_counter()
        deadline = started + (self.config.timeout_ms / 1000.0)
        state = AgentRunState(
            run_id=_new_run_id(req),
            request=req.goal,
            run_type=req.run_type,
            metadata={"max_recoveries": self.config.max_recoveries},
        )

        if req.model:
            from qa_orchestrator.intent_classifier import IntentClassifier
            from qa_orchestrator.llm_client import PlannerLlmClient
            from qa_orchestrator.qa_planner import QaPlanner

            self.orchestrator.llm = PlannerLlmClient.from_env(model_id=req.model)
            self.orchestrator.classifier = IntentClassifier(self.orchestrator.graph, self.orchestrator.llm)
            self.orchestrator.qa_planner = QaPlanner(
                self.orchestrator.graph,
                self.orchestrator.llm,
                retriever=getattr(self.orchestrator, "retriever", None),
            )

        state = self._phase_plan(state, req)
        if state.status in _TERMINAL:
            return self._finalize(state, req, started)

        while state.iteration < self.config.max_iterations and time.perf_counter() < deadline:
            state.iteration += 1
            state.updated_at = datetime.now(timezone.utc).isoformat()

            if state.step_count >= self.config.max_steps:
                state.status = "NEEDS_REVIEW"
                state.reason_code = "agent.max_steps"
                state.summary = "Agent step limit reached"
                break

            terminal = self._run_iteration(state, req)
            state = terminal
            if state.status in _TERMINAL:
                break

        if state.status not in _TERMINAL:
            state.status = "NEEDS_REVIEW"
            state.reason_code = state.reason_code or "agent.max_iterations"
            state.summary = state.summary or "Agent iteration limit reached"

        return self._finalize(state, req, started)

    def _run_iteration(self, state: AgentRunState, req: RunRequest) -> AgentRunState:
        action, entry = self.engine.decide(state)
        policy = self.policy.validate(action, state)
        if not policy.allowed:
            entry.approved = False
            entry.result = policy.reason
            state.decision_journal.append(entry)
            state.status = "BLOCKED"
            state.reason_code = "agent.policy_blocked"
            state.summary = policy.reason
            return state

        if action.type == "STOP":
            entry.result = self._terminal_from_state(state)
            state.decision_journal.append(entry)
            state.status = self._status_from_result(state)
            return state

        if action.type == "WAIT_FOR_REVIEW":
            entry.result = "paused for human approval"
            state.decision_journal.append(entry)
            state.status = "WAITING_FOR_APPROVAL"
            state.reason_code = state.reason_code or "approval.required"
            state.summary = action.reason
            state.final_result = "WAITING_FOR_APPROVAL"
            return state

        assert state.plan is not None and state.suite_plan is not None and state.execution_plan is not None

        if action.type == "EXPLORE" and state.exploration is None:
            state.status = "EXECUTING"
            entry.result = "exploring"
            state.decision_journal.append(entry)
            state.exploration, _ = self.executor.explore(
                planning=state.plan,
                run_id=state.run_id,
                skip_discovery=req.skip_discovery,
            )
            if state.exploration:
                state.evidence_paths.extend(state.exploration.screenshots)
            state.status = "READY"
            return state

        if action.type == "RUN_EXISTING_TEST":
            state.status = "EXECUTING"
            entry.result = "running approved test"
            state.decision_journal.append(entry)
            state.execution = self.executor.run_existing_test(
                suite_plan=state.suite_plan,
                run_id=state.run_id,
                skip_execution=req.skip_execution,
            )
            if state.suite_plan:
                state.metadata["suite_plan_commands"] = list(state.suite_plan.commands or [])
                state.metadata["selected_flow_ids"] = list(state.suite_plan.flow_ids or [])
            if state.execution and state.execution.observations:
                for obs in state.execution.observations:
                    meta = obs.meta or {}
                    if meta.get("live_diagnostics"):
                        state.metadata["live_diagnostics"] = meta["live_diagnostics"]
                    if meta.get("param_trace"):
                        state.metadata["param_trace"] = meta["param_trace"]
                    if meta.get("executed_test_case_ids"):
                        state.metadata["executed_test_case_ids"] = list(meta["executed_test_case_ids"])
                        state.current_test = state.metadata["executed_test_case_ids"][0]
                    if meta.get("command"):
                        state.metadata.setdefault("executed_commands", []).append(meta.get("command"))
            state.current_flow = state.suite_plan.flow_ids[0] if state.suite_plan.flow_ids else state.current_flow
            state.step_count += max(1, len(state.suite_plan.commands))
            return self._observe_verify(state, req)

        if action.type in {"CAPTURE_EVIDENCE", "VERIFY"}:
            state.status = "EXECUTING"
            entry.result = action.type.lower()
            state.decision_journal.append(entry)
            state = self.executor.execute_action(
                action,
                state=state,
                request=req,
                planning=state.plan,
                suite_plan=state.suite_plan,
                execution_plan=state.execution_plan,
            )
            if action.type == "VERIFY" and state.validation:
                state.status = self._status_from_validation(state.validation.conclusion)
                state.final_result = state.validation.conclusion
                state.reason_code = state.validation.reason_code
                state.summary = state.validation.summary
                if state.validation.decision_diagnostics:
                    attach_diagnostic_to_state(state, state.validation.decision_diagnostics)
                    entry.decision_diagnostics = state.validation.decision_diagnostics
                    log_decision_block(state.decision_diagnostics)
            return state

        if action.type == "RECOVER_LOCATOR":
            return self._recover(state, req, entry)

        entry.result = "unsupported action"
        state.decision_journal.append(entry)
        state.status = "NEEDS_REVIEW"
        return state

    def _observe_verify(self, state: AgentRunState, req: RunRequest) -> AgentRunState:
        state.status = "OBSERVING"
        if state.execution and not state.execution.ok:
            state.failure = self._classify_execution_failure(state)
            state.recovery_history.append(state.failure)
            if state.failure.recovery_eligible and state.recovery_count < self.config.max_recoveries:
                return self._recover(state, req, None)
            state.status = "NEEDS_REVIEW"
            state.reason_code = "execution.failed"
            state.summary = state.failure.message
            state.final_result = "NEEDS_REVIEW"
            return state

        assert state.plan and state.suite_plan and state.execution_plan
        capture = AgentAction(type="CAPTURE_EVIDENCE", reason="post-execution evidence capture")
        state = self.executor.execute_action(
            capture,
            state=state,
            request=req,
            planning=state.plan,
            suite_plan=state.suite_plan,
            execution_plan=state.execution_plan,
        )
        verify = AgentAction(type="VERIFY", reason="ground-truth verification")
        state = self.executor.execute_action(
            verify,
            state=state,
            request=req,
            planning=state.plan,
            suite_plan=state.suite_plan,
            execution_plan=state.execution_plan,
        )
        if state.validation:
            state.status = self._status_from_validation(state.validation.conclusion)
            state.final_result = state.validation.conclusion
            state.reason_code = state.validation.reason_code
            state.summary = state.validation.summary
            if state.validation.decision_diagnostics:
                attach_diagnostic_to_state(state, state.validation.decision_diagnostics)
                log_decision_block(state.decision_diagnostics)
        return state

    def _recover(
        self,
        state: AgentRunState,
        req: RunRequest,
        entry: AgentDecisionEntry | None,
    ) -> AgentRunState:
        if entry is None:
            action, entry = self.engine.decide(state)
            if action.type != "RECOVER_LOCATOR":
                state.status = "NEEDS_REVIEW"
                return state
        state.status = "RECOVERING"
        entry.result = "recovering"
        state.decision_journal.append(entry)
        assert state.plan and state.suite_plan and state.execution_plan
        recover_action = AgentAction(type="RECOVER_LOCATOR", reason=entry.reason)
        state = self.executor.execute_action(
            recover_action,
            state=state,
            request=req,
            planning=state.plan,
            suite_plan=state.suite_plan,
            execution_plan=state.execution_plan,
        )
        if state.failure:
            state.failure.recovery_attempted = True
            state.failure.recovery_outcome = state.healing_result.status if state.healing_result else "none"
        if state.healing_result and state.healing_result.status == "HEALED_PENDING_APPROVAL":
            state.status = "WAITING_FOR_APPROVAL"
            state.reason_code = "healing.pending_approval"
            state.summary = state.healing_result.message
            state.final_result = "WAITING_FOR_APPROVAL"
            state.metadata["approval_pause_kind"] = "healing"
            state.metadata["checkpoint"] = "after_healing_proposal"
            return state
        state.status = "NEEDS_REVIEW"
        state.reason_code = "recovery.exhausted"
        state.summary = state.healing_result.message if state.healing_result else "Recovery did not succeed"
        state.final_result = "NEEDS_REVIEW"
        return state

    def _phase_plan(self, state: AgentRunState, req: RunRequest) -> AgentRunState:
        state.status = "PLANNING"
        intent = self.orchestrator.classifier.classify(
            req.goal,
            run_type=req.run_type,
            context_packets=req.context_packets,
        )
        planning = self.orchestrator.qa_planner.plan(intent, context_packets=req.context_packets)
        suite_plan = self.orchestrator.selector.select(planning.intent)
        execution_plan = intent_to_execution_plan(planning.intent)

        state.intent = intent
        state.plan = planning
        state.retrieval_used = bool(planning.retrieval_diagnostics)
        state.suite_plan = suite_plan
        state.execution_plan = execution_plan
        state.selected_flows = list(planning.selected_flows or suite_plan.flow_ids)
        state.current_flow = state.selected_flows[0] if state.selected_flows else None

        state.decision_journal.append(
            AgentDecisionEntry(
                iteration=state.iteration,
                state=state.status,
                decision="PLAN",
                reason=planning.reasoning_summary or planning.strategy,
                source="RULE",
                confidence=planning.confidence,
                result=planning.strategy,
            )
        )

        if planning.strategy == "BLOCK":
            return self._terminal(state, "BLOCKED", "planner.blocked", planning.reasoning_summary or "Planner blocked request")

        if planning.generation_required and planning.strategy != "BLOCK":
            state.generation_result = self.executor.generate(
                planning=planning,
                exploration=state.exploration,
                run_id=state.run_id,
            )
            paused = self._terminal(
                state,
                "WAITING_FOR_APPROVAL",
                "generation.pending_approval",
                "Generated artifacts require SME approval",
            )
            paused.metadata["approval_pause_kind"] = "generation"
            paused.metadata["checkpoint"] = "after_generation"
            return paused

        if planning.requires_human_approval or (
            not planning.execution_allowed and planning.strategy in {"ASK_USER", "GENERATE"}
        ):
            if suite_plan.commands and planning.strategy == "REUSE_EXISTING" and not req.skip_execution:
                state.status = "READY"
                return state
            return self._terminal(state, "WAITING_FOR_APPROVAL", "approval.pending", planning.reasoning_summary or "Human approval required")

        if req.skip_execution or planning.strategy in {"EXPLORE", "ASK_USER"}:
            if planning.exploration_required and not req.skip_discovery:
                state.status = "READY"
                return state
            if req.skip_execution:
                state.execution = ExecutionResult(ok=True, mode="skipped", observations=[])
                return self._observe_verify(state, req)
            state.status = "READY"
            return state

        if not planning.execution_allowed:
            if suite_plan.commands and not req.skip_execution:
                state.status = "READY"
                return state
            return self._terminal(
                state,
                "WAITING_FOR_APPROVAL",
                "execution.blocked",
                "No executable flows passed ExecutionGate",
            )

        state.status = "READY"
        return state

    def _terminal(self, state: AgentRunState, status: str, reason_code: str, summary: str) -> AgentRunState:
        state.status = status  # type: ignore[assignment]
        state.reason_code = reason_code
        state.summary = summary
        state.final_result = {
            "BLOCKED": "BLOCKED",
            "WAITING_FOR_APPROVAL": "WAITING_FOR_APPROVAL",
        }.get(status, status)
        if status in {"WAITING_FOR_APPROVAL", "BLOCKED", "NEEDS_REVIEW"}:
            from qa_orchestrator.execution_gate import ExecutionGate

            diagnostic: dict[str, Any] | None = None
            if state.plan and state.plan.execution_gates:
                gate = ExecutionGate(self.orchestrator.graph)
                blocked = next((g for g in state.plan.execution_gates if not g.executable), None)
                if blocked:
                    diagnostic = build_execution_gate_block_diagnostic(
                        gate,
                        blocked.flow_id,
                        run_id=state.run_id,
                        stage="execution_gate" if status == "WAITING_FOR_APPROVAL" else "agent_terminal",
                    )
            if diagnostic is None:
                diagnostic = build_terminal_diagnostic(
                    run_id=state.run_id,
                    stage="agent_terminal",
                    status=status,
                    reason_code=reason_code,
                    message=summary,
                    failed_checks=[reason_code],
                    extra={
                        "selected_flow_ids": state.selected_flows,
                        "current_action": state.current_action.type if state.current_action else None,
                        "approval_pause_kind": state.metadata.get("approval_pause_kind"),
                    },
                )
            attach_diagnostic_to_state(state, diagnostic)
        if status == "WAITING_FOR_APPROVAL" and "approval_pause_kind" not in state.metadata:
            state.metadata["approval_pause_kind"] = "execution_gate"
            state.metadata["checkpoint"] = "before_execution"
        return state

    def _continue_from_state(self, state: AgentRunState, req: RunRequest) -> AgentRunResult:
        started = time.perf_counter()
        deadline = started + (self.config.timeout_ms / 1000.0)
        while state.iteration < self.config.max_iterations and time.perf_counter() < deadline:
            state.iteration += 1
            state.updated_at = datetime.now(timezone.utc).isoformat()
            state = self._run_iteration(state, req)
            if state.status in _TERMINAL:
                break
        if state.status not in _TERMINAL:
            state.status = "NEEDS_REVIEW"
            state.reason_code = state.reason_code or "agent.max_iterations"
        return self._finalize(state, req, started)

    def _classify_execution_failure(self, state: AgentRunState) -> AgentFailureRecord:
        execution = state.execution or ExecutionResult(ok=False, mode="missing", observations=[])
        failed_obs = next((obs for obs in execution.observations if not obs.ok), None)
        if failed_obs is None and execution.error:
            failed_obs = StepObservation(step_index=0, action="execution", ok=False, message=execution.error)
        if failed_obs is None:
            return AgentFailureRecord(category="UNKNOWN", message=execution.error or "execution failed")
        flow_id = state.current_flow or ""
        classified = classify_failure(
            observation=failed_obs,
            flow_id=flow_id,
            test_id=flow_id,
        )
        return AgentFailureRecord(
            category=_map_failure_category(classified.type),
            message=classified.error_message or failed_obs.message or "execution failed",
            evidence=[p for p in [classified.screenshot_path, classified.dom_evidence_path] if p],
            recovery_eligible=is_healing_eligible(classified),
        )

    def _status_from_validation(self, conclusion: str) -> str:
        if conclusion == "PASS":
            return "COMPLETED"
        if conclusion == "FAIL":
            return "FAILED"
        return "NEEDS_REVIEW"

    def _status_from_result(self, state: AgentRunState) -> str:
        if state.final_result == "PASS":
            return "COMPLETED"
        if state.final_result == "FAIL":
            return "FAILED"
        if state.final_result == "WAITING_FOR_APPROVAL":
            return "WAITING_FOR_APPROVAL"
        if state.final_result == "BLOCKED":
            return "BLOCKED"
        return state.status if state.status in _TERMINAL else "NEEDS_REVIEW"

    def _terminal_from_state(self, state: AgentRunState) -> str:
        if state.validation:
            return state.validation.conclusion
        return state.final_result or state.status

    def _finalize(self, state: AgentRunState, req: RunRequest, started: float) -> AgentRunResult:
        if not state.final_result:
            state.final_result = {
                "COMPLETED": "PASS",
                "FAILED": "FAIL",
                "BLOCKED": "BLOCKED",
                "NEEDS_REVIEW": "NEEDS_REVIEW",
                "WAITING_FOR_APPROVAL": "WAITING_FOR_APPROVAL",
            }.get(state.status, state.status)

        save_journal(state, base_dir=self.config.journal_dir)
        if state.status in {"WAITING_FOR_APPROVAL", "NEEDS_REVIEW", "COMPLETED", "FAILED", "BLOCKED"}:
            pause_kind = str(state.metadata.get("approval_pause_kind", "none"))
            if state.status == "WAITING_FOR_APPROVAL" and pause_kind == "none":
                pause_kind = "execution_gate"
            if state.status == "NEEDS_REVIEW":
                pause_kind = "after_validation"
            snapshot = build_snapshot_from_state(
                state,
                req,
                pause_kind=pause_kind,
                automation_dir=self.orchestrator.graph.automation_dir,
            )
            save_snapshot(snapshot, base_dir=self.config.journal_dir)
        if state.decision_diagnostics:
            log_decision_block(state.decision_diagnostics)
        elif state.status == "WAITING_FOR_APPROVAL":
            log_decision_block(
                build_terminal_diagnostic(
                    run_id=state.run_id,
                    stage="agent_terminal",
                    status=state.status,
                    reason_code=state.reason_code or "approval.pending",
                    message=state.summary,
                    failed_checks=[state.reason_code or "approval.pending"],
                )
            )
        try:
            from qa_orchestrator.live_browser_finalize import finalize_live_browser_after_agent_run

            finalize_live_browser_after_agent_run(state.run_id)
        except ImportError:
            pass

        orchestrator_result = self._to_orchestrator_result(state, req)
        metrics = metrics_from_single_run(
            AgentRunResult(
                state=state,
                conclusion=state.final_result or state.status,
                reason_code=state.reason_code or orchestrator_result.reason_code,
                summary=state.summary or orchestrator_result.summary,
            )
        )
        metrics.execution_success_rate = metrics.execution_attempt_success_rate
        metrics.approval_escalation_rate = metrics.waiting_for_approval_rate
        metrics.recovery_success_rate = metrics.recovery_success_rate
        return AgentRunResult(
            state=state,
            conclusion=state.final_result,
            reason_code=state.reason_code or orchestrator_result.reason_code,
            summary=state.summary or orchestrator_result.summary,
            metrics=metrics,
            report_markdown=orchestrator_result.report_markdown,
            orchestrator_metadata={
                **orchestrator_result.metadata,
                "agent_status": state.status,
                "agent_iterations": state.iteration,
                "agent_recoveries": state.recovery_count,
                "agent_elapsed_ms": int((time.perf_counter() - started) * 1000),
                "decision_diagnostics": state.decision_diagnostics,
            },
        )

    def _to_orchestrator_result(self, state: AgentRunState, req: RunRequest) -> OrchestratorResult:
        execution = state.execution or ExecutionResult(ok=True, mode="skipped", observations=[])
        validation = state.validation
        if validation is None:
            validation = self.orchestrator.validator.validate(
                goal=req.goal,
                run_type=req.run_type,
                plan=state.execution_plan or intent_to_execution_plan(state.intent),  # type: ignore[arg-type]
                execution=execution,
                intent=state.intent,  # type: ignore[arg-type]
                suite_plan=state.suite_plan,  # type: ignore[arg-type]
                discovery=state.discovery,
            )
        if state.exploration is None and state.plan and state.plan.exploration_required and not req.skip_discovery:
            state.exploration, _ = self.executor.explore(
                planning=state.plan,
                run_id=state.run_id,
                skip_discovery=req.skip_discovery,
            )
        if state.discovery is None and state.intent:
            state.discovery = self.executor.discover(
                intent=state.intent,
                suite_plan=state.suite_plan,  # type: ignore[arg-type]
                exploration=state.exploration,
                skip_discovery=req.skip_discovery,
            )

        result = OrchestratorResult(
            conclusion=validation.conclusion,
            reason_code=validation.reason_code,
            summary=validation.summary,
            goal=req.goal,
            run_type=req.run_type,
            intent=state.intent,  # type: ignore[arg-type]
            planning=state.plan,
            suite_plan=state.suite_plan,  # type: ignore[arg-type]
            discovery=state.discovery,
            exploration=state.exploration,
            generation_result=state.generation_result,
            healing_result=state.healing_result,
            plan=state.execution_plan,  # type: ignore[arg-type]
            execution=execution,
            validation=validation,
            metadata={
                "classifier": state.intent.classifier if state.intent else None,
                "planner": state.plan.planner if state.plan else None,
                "planning_strategy": state.plan.strategy if state.plan else None,
                "execution_allowed": state.plan.execution_allowed if state.plan else False,
                "exploration_status": state.exploration.status if state.exploration else None,
                "generation_status": state.generation_result.status if state.generation_result else None,
                "healing_status": state.healing_result.status if state.healing_result else None,
                "execution_mode": state.intent.execution_mode if state.intent else None,
                "run_id": state.run_id,
                "executor": getattr(self.orchestrator.executor, "mode", type(self.orchestrator.executor).__name__),
                "validation_phase": validation.phase,
                "llm_enabled": self.orchestrator.llm.enabled,
                "llm_provider": self.orchestrator.llm.provider,
                "primary_flow_count": len(self.orchestrator.graph.ready_flow_ids()),
                "supporting_draft_count": len(self.orchestrator.graph.draft_flow_ids()),
                "agent_status": state.status,
                "agent_iterations": state.iteration,
                "agent_recoveries": state.recovery_count,
                "decision_diagnostics": state.decision_diagnostics,
                "agent_llm_calls": self.engine.llm_call_count,
                "agent_llm_latency_ms": self.engine.llm_latency_ms,
                "retrieval_used": state.retrieval_used,
            },
        )
        result.report_markdown = build_markdown_report(result=result)
        return result

    def to_orchestrator_result(self, agent_result: AgentRunResult) -> OrchestratorResult:
        req = RunRequest(goal=agent_result.state.request, run_type=agent_result.state.run_type)
        return self._to_orchestrator_result(agent_result.state, req)
