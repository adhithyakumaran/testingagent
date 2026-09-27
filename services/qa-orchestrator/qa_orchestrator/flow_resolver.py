"""P12 — deterministic flow discovery + selection (LLM may explain/rerank, never invent flows)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from qa_orchestrator.flow_audit_registry import audit_record
from qa_orchestrator.flow_intent import (
    FLOW_SEARCH_PRODUCT,
    FLOW_VIEW_PRODUCT,
    extract_explicit_flow_ids,
    extract_sku,
    primary_flow_for_product_kind,
    resolve_product_intent_kind,
    supporting_flows_for_product_kind,
)
from qa_orchestrator.knowledge_graph import FlowKnowledgeGraph
from qa_orchestrator.llm_client import PlannerLlmClient

FlowResolutionDecision = Literal["EXECUTE", "FLOW_MISMATCH", "DISCOVERY_REQUIRED"]

RERANK_SYSTEM = """You explain and rank QA automation flows for Endless Aisle.
Return ONLY valid JSON:
  primary_flow_id (string — MUST be one of allowed_candidates)
  explanation (one sentence)
  confidence (0.0-1.0)
Never invent a flow id outside allowed_candidates."""


class FlowCandidateDiagnostic(BaseModel):
    flow_id: str
    score: float = 0.0
    capability_match: bool = False
    scenario_match: bool = False
    parameter_compatible: bool = True
    path_verified: bool = False
    automation_verified: bool = False
    executable: bool = False
    notes: list[str] = Field(default_factory=list)


class FlowResolutionResult(BaseModel):
    decision: FlowResolutionDecision = "EXECUTE"
    primary_flow_id: str | None = None
    supporting_flow_ids: list[str] = Field(default_factory=list)
    candidate_flows: list[FlowCandidateDiagnostic] = Field(default_factory=list)
    confidence: float = 0.0
    match_reasons: list[str] = Field(default_factory=list)
    path_verified: bool = False
    automation_verified: bool = False
    mismatch_detected: bool = False
    capability: str | None = None
    intent_kind: str | None = None
    llm_explanation: str | None = None


class FlowResolver:
    """Canonical resolver: intent → bounded candidates → constraints → optional LLM rerank."""

    _INTENT_CAPABILITY: dict[str, str] = {
        "search_product": "Product Search",
        "view_product": "Product Management",
        "browse_catalogue": "Product Management",
        "home_navigation": "Application Navigation",
        "item_search_entry": "Product Search",
    }

    def __init__(
        self,
        graph: FlowKnowledgeGraph,
        llm: PlannerLlmClient | None = None,
    ) -> None:
        self.graph = graph
        self.llm = llm or PlannerLlmClient(enabled=False)
        self._audit_root = graph.discovery_root

    def resolve(self, goal: str, *, intent_flow_ids: list[str] | None = None) -> FlowResolutionResult:
        intent_kind = self._resolve_intent_kind(goal)
        capability = self._INTENT_CAPABILITY.get(intent_kind or "", "") or None
        sku = extract_sku(goal)

        candidates = self._collect_candidates(goal, intent_kind, intent_flow_ids or [])
        diagnostics = [self._score_candidate(fid, intent_kind, capability, sku, goal) for fid in candidates]

        primary, supporting, reasons, mismatch = self._pick_primary(
            goal, intent_kind, diagnostics, intent_flow_ids or []
        )

        primary_diag = next((d for d in diagnostics if d.flow_id == primary), None)

        decision: FlowResolutionDecision = "EXECUTE"
        if mismatch:
            decision = "FLOW_MISMATCH"
        elif not primary:
            decision = "DISCOVERY_REQUIRED"
        elif intent_kind is None and not intent_flow_ids:
            decision = "DISCOVERY_REQUIRED"
        elif intent_kind is None and primary_diag and primary_diag.score < 40 and not primary_diag.scenario_match:
            decision = "DISCOVERY_REQUIRED"
        elif not self._trusted_executable(primary, diagnostics):
            if intent_kind and intent_kind not in {"home_navigation", "browse_catalogue"}:
                decision = "DISCOVERY_REQUIRED"

        confidence = self._confidence(primary, diagnostics, intent_kind, sku is not None)
        llm_explanation = None

        if (
            self.llm.enabled
            and decision == "EXECUTE"
            and primary
            and len([d for d in diagnostics if d.score >= diagnostics[0].score - 5]) > 1
        ):
            primary, llm_explanation, confidence = self._llm_rerank(
                goal, primary, [d.flow_id for d in diagnostics if d.executable][:6], confidence
            )

        primary_diag = next((d for d in diagnostics if d.flow_id == primary), None)
        return FlowResolutionResult(
            decision=decision,
            primary_flow_id=primary,
            supporting_flow_ids=supporting,
            candidate_flows=diagnostics,
            confidence=confidence,
            match_reasons=reasons,
            path_verified=bool(primary_diag and primary_diag.path_verified),
            automation_verified=bool(primary_diag and primary_diag.automation_verified),
            mismatch_detected=mismatch,
            capability=capability,
            intent_kind=intent_kind,
            llm_explanation=llm_explanation,
        )

    def _resolve_intent_kind(self, goal: str) -> str | None:
        product = resolve_product_intent_kind(goal)
        if product:
            return product
        g = goal.lower()
        if "catalogue" in g or "catalog" in g:
            return "browse_catalogue"
        if "home" in g or "navigation" in g:
            return "home_navigation"
        if any(p in g for p in ("item search", "search sku", "product search")):
            return "search_product"
        return None

    def _collect_candidates(
        self,
        goal: str,
        intent_kind: str | None,
        intent_flow_ids: list[str],
    ) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []

        def add(ids: list[str]) -> None:
            for fid in ids:
                if not fid or fid in seen:
                    continue
                if not self.graph.flow_meta(fid):
                    continue
                seen.add(fid)
                out.append(fid)

        if intent_kind == "view_product":
            add([FLOW_VIEW_PRODUCT, *supporting_flows_for_product_kind("view_product")])
        elif intent_kind == "search_product":
            add([FLOW_SEARCH_PRODUCT, "BF-HOME-010-01"])
        add([f for f in intent_flow_ids if self.graph._is_primary(f)])
        if intent_kind:
            cap = self._INTENT_CAPABILITY.get(intent_kind)
            if cap:
                add(self.graph.flows_for_capability(cap))
        add(self.graph.flows_for_query_semantic(goal, limit=6))
        return out

    def _score_candidate(
        self,
        flow_id: str,
        intent_kind: str | None,
        capability: str | None,
        sku: str | None,
        goal: str,
    ) -> FlowCandidateDiagnostic:
        notes: list[str] = []
        score = 0.0
        audit = audit_record(self._audit_root, flow_id) or {}
        flow_cap = self.graph.capability_for_flow(flow_id) or str(audit.get("business_capability") or "")
        cap_match = bool(capability and flow_cap and capability.lower() in flow_cap.lower())
        if cap_match:
            score += 30
        intent_kinds = [str(x) for x in audit.get("intent_kinds") or []]
        scenario_match = bool(intent_kind and intent_kind in intent_kinds)
        if scenario_match:
            score += 25
        forbidden = [str(x) for x in audit.get("forbidden_primary_intents") or []]
        if intent_kind and intent_kind in forbidden:
            score -= 40
            notes.append(f"forbidden_primary_for_{intent_kind}")
        supporting_only = audit.get("supporting_only_for") or []
        if intent_kind and supporting_only and intent_kind in [str(x) for x in supporting_only]:
            score -= 15
            notes.append("supporting_only_for_intent")

        param_ok = True
        req = audit.get("required_parameters") or []
        if req and any(str(r.get("required_for")) == "parameterized_runs" for r in req if isinstance(r, dict)):
            if not sku and "sku" in goal.lower():
                param_ok = False
                notes.append("sku_missing")
            elif sku:
                score += 10

        path_verified = bool((audit.get("automation") or {}).get("path_verified"))
        automation_verified = bool((audit.get("automation") or {}).get("automation_verified"))
        if path_verified:
            score += 15
        if automation_verified:
            score += 10

        gate = self.graph.evaluate_execution(flow_id)
        executable = gate.executable
        if executable:
            score += 20
        else:
            notes.append(f"gate:{gate.reason_code}")

        if intent_kind == "view_product" and flow_id == FLOW_VIEW_PRODUCT:
            score += 50
        if intent_kind == "search_product" and flow_id == FLOW_SEARCH_PRODUCT:
            score += 50

        return FlowCandidateDiagnostic(
            flow_id=flow_id,
            score=score,
            capability_match=cap_match,
            scenario_match=scenario_match,
            parameter_compatible=param_ok,
            path_verified=path_verified,
            automation_verified=automation_verified,
            executable=executable,
            notes=notes,
        )

    def _pick_primary(
        self,
        goal: str,
        intent_kind: str | None,
        diagnostics: list[FlowCandidateDiagnostic],
        intent_flow_ids: list[str],
    ) -> tuple[str | None, list[str], list[str], bool]:
        if not diagnostics:
            return None, [], ["No candidate flows in knowledge graph"], False

        ranked = sorted(diagnostics, key=lambda d: d.score, reverse=True)
        reasons: list[str] = []
        mismatch = False

        for fid in extract_explicit_flow_ids(goal):
            if not self.graph._is_primary(fid):
                continue
            pref = next((d for d in diagnostics if d.flow_id == fid), None)
            if not pref or not pref.executable:
                continue
            supporting = list(
                dict.fromkeys(
                    [
                        *[f for f in extract_explicit_flow_ids(goal) if f != fid],
                        *[f for f in intent_flow_ids if f != fid],
                    ]
                )
            )
            if intent_kind == "search_product" and fid != FLOW_SEARCH_PRODUCT:
                if FLOW_SEARCH_PRODUCT not in supporting:
                    supporting.append(FLOW_SEARCH_PRODUCT)
            elif intent_kind == "view_product" and fid != FLOW_VIEW_PRODUCT:
                if FLOW_SEARCH_PRODUCT not in supporting:
                    supporting.append(FLOW_SEARCH_PRODUCT)
            reasons.append(f"Explicit canonical flow id {fid} in user request")
            return fid, supporting[:4], reasons, False

        if intent_flow_ids and intent_kind not in {"view_product", "search_product"}:
            preferred = intent_flow_ids[0]
            meta = self.graph.flow_meta(preferred) or {}
            if meta.get("status") == "SUPERSEDED" and meta.get("superseded_by"):
                preferred = str(meta["superseded_by"])
            pref = next((d for d in diagnostics if d.flow_id == preferred), None)
            if pref and pref.executable:
                supporting = [f for f in intent_flow_ids[1:4] if f != preferred]
                return preferred, supporting, [f"Classifier-selected executable flow {preferred}"], False

        if intent_kind == "view_product":
            required = FLOW_VIEW_PRODUCT
            if required not in {d.flow_id for d in ranked}:
                return None, supporting_flows_for_product_kind("view_product"), ["View product intent — BF-PRODUCT-004 not in candidates"], False
            primary = required
            supporting = list(
                dict.fromkeys(
                    [
                        *supporting_flows_for_product_kind("view_product"),
                        *[d.flow_id for d in ranked if d.flow_id != primary][:3],
                    ]
                )
            )
            wrong = [fid for fid in intent_flow_ids if fid != primary and fid in {FLOW_SEARCH_PRODUCT, "BF-HOME-010-01"}]
            if wrong:
                mismatch = True
                reasons.append(f"Stale classifier path {wrong[0]} conflicts with view_product")
            for d in ranked:
                if d.flow_id == FLOW_SEARCH_PRODUCT and d.score > ranked[0].score - 10 and primary != FLOW_SEARCH_PRODUCT:
                    if "forbidden_primary_for_view_product" in d.notes:
                        mismatch = True
                        reasons.append("BF-PRODUCT-003 cannot be primary for view intent")
            reasons.append("Deterministic view_product → BF-PRODUCT-004")
            return primary, supporting, reasons, mismatch

        if intent_kind == "search_product":
            primary = FLOW_SEARCH_PRODUCT
            supporting = [f for f in ["BF-HOME-010-01"] if f != primary]
            if intent_flow_ids and intent_flow_ids[0] == FLOW_VIEW_PRODUCT:
                mismatch = True
                reasons.append("View flow cannot execute search intent")
            reasons.append("Deterministic search_product → BF-PRODUCT-003")
            return primary, supporting, reasons, mismatch

        executable = [d for d in ranked if d.executable]
        if not executable:
            return None, [], ["No executable candidates after gate"], False

        primary = executable[0].flow_id
        supporting = [d.flow_id for d in executable[1:4] if d.flow_id != primary]
        audit = audit_record(self._audit_root, primary) or {}
        must_not = (audit.get("expected_end_state") or {}).get("must_not_be_primary_verdict_for")
        if intent_kind and must_not == intent_kind:
            mismatch = True
            reasons.append(f"{primary} documented as non-primary for {intent_kind}")
        reasons.append(f"Ranked candidate {primary} score={executable[0].score:.0f}")
        return primary, supporting, reasons, mismatch

    def _trusted_executable(self, primary: str, diagnostics: list[FlowCandidateDiagnostic]) -> bool:
        diag = next((d for d in diagnostics if d.flow_id == primary), None)
        if not diag or not diag.executable:
            return False
        audit = audit_record(self._audit_root, primary)
        if not audit:
            return True
        return diag.path_verified or diag.automation_verified

    def _confidence(
        self,
        primary: str | None,
        diagnostics: list[FlowCandidateDiagnostic],
        intent_kind: str | None,
        has_sku: bool,
    ) -> float:
        if not primary:
            return 0.2
        diag = next((d for d in diagnostics if d.flow_id == primary), None)
        base = 0.55
        if intent_kind in {"view_product", "search_product"}:
            base = 0.92
        if diag:
            base += min(0.08, diag.score / 500)
        if has_sku:
            base += 0.03
        return min(0.99, base)

    def _llm_rerank(
        self,
        goal: str,
        deterministic_primary: str,
        allowed: list[str],
        confidence: float,
    ) -> tuple[str, str | None, float]:
        if deterministic_primary not in allowed:
            allowed = [deterministic_primary, *allowed]
        data, _resp = self.llm.complete_json(
            purpose="flow_resolver_rerank",
            system=RERANK_SYSTEM,
            prompt=(
                f"User request: {goal}\n"
                f"Deterministic primary: {deterministic_primary}\n"
                f"allowed_candidates: {allowed}\n"
            ),
        )
        if not data:
            return deterministic_primary, None, confidence
        pick = str(data.get("primary_flow_id") or deterministic_primary)
        if pick not in allowed:
            return deterministic_primary, "LLM pick rejected — not in allowed candidates", confidence
        expl = str(data.get("explanation") or "")
        conf = float(data.get("confidence") or confidence)
        if pick != deterministic_primary and pick in {FLOW_SEARCH_PRODUCT, "BF-HOME-010-01"}:
            return deterministic_primary, "LLM rerank ignored — would override product intent constraint", confidence
        return pick, expl or None, conf
