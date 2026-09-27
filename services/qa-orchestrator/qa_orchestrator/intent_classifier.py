from __future__ import annotations

import re
from typing import Any

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
from qa_orchestrator.models import ExecutionMode, IntentClassification


CLASSIFIER_SYSTEM = """You are ScoutAI — enterprise QA orchestrator for Oracle APEX Endless Aisle UAT.
Classify the user's natural-language request with HIGH clarity. Do NOT invent browser steps.
Return ONLY valid JSON with keys:
  execution_mode (morning_sanity|regression_suite|negative_suite|adhoc_existing|adhoc_parameterized|incident_multi_flow|new_feature|discover)
  capability (string — e.g. Authentication, Product Search, Inventory, Rivaah, Billing)
  suite_topic (short label — e.g. "Morning sanity · all READY flows" or "Adhoc · Product Search · BF-PRODUCT-003")
  flow_ids (array of BF-* ids — prefer READY primary flows from context)
  supporting_flow_ids (array of DRAFT BF-* ids for context only)
  suite_ids (array e.g. SUITE-SANITY-MORNING, SUITE-REGRESSION-FULL, or per-flow tags)
  params (object — e.g. sku, item_code, search_term)
  confidence (0.0-1.0 — use >=0.9 when intent is unambiguous)
  reasoning (2 sentences: what user wants + which suites/flows will run and why)
Use 19 READY flows as primary automation. DRAFT flows are supporting context only — never sole execution target.

Examples:
- "morning sanity" → morning_sanity, capability=Application Navigation, flow_ids=all READY, confidence=0.95
- "check login" → adhoc_existing, BF-LOGIN-001, capability=Authentication, confidence=0.92
- "search SKU 12345678901234" → adhoc_parameterized, params.sku=12345678901234, flow_ids=[BF-PRODUCT-003, BF-HOME-010-01]
- "new banner on product page" → new_feature, flow_ids product-related READY flows, confidence=0.88
- "payment failing checkout" → incident_multi_flow, traverse payment/checkout capabilities"""


class IntentClassifier:
    def __init__(self, graph: FlowKnowledgeGraph, llm: PlannerLlmClient) -> None:
        self.graph = graph
        self.llm = llm

    def classify(
        self,
        goal: str,
        *,
        run_type: str = "adhoc",
        context_packets: list[dict[str, Any]] | None = None,
    ) -> IntentClassification:
        llm_data, llm_resp = self._classify_llm(goal, run_type=run_type, context_packets=context_packets)
        if llm_data:
            intent = self._from_llm(goal, run_type, llm_data)
            if intent.flow_ids or intent.execution_mode == "morning_sanity":
                return self._apply_product_capability_routing(intent)

        intent = self._classify_deterministic(goal, run_type=run_type, llm_error=llm_resp.error)
        return self._apply_product_capability_routing(intent)

    def _classify_llm(
        self,
        goal: str,
        *,
        run_type: str,
        context_packets: list[dict[str, Any]] | None,
    ) -> tuple[dict[str, Any] | None, Any]:
        kb_context = self.graph.flow_kb.context_block(goal, limit=6)[0]
        graph_ctx = self.graph.graph_context(goal)
        packet_text = ""
        if context_packets:
            packet_text = "\n".join(str(p) for p in context_packets[:5])

        return self.llm.complete_json(
            purpose="intent_classify",
            system=CLASSIFIER_SYSTEM,
            prompt=(
                f"Run type hint: {run_type}\nUser request: {goal}\n\n"
                f"Knowledge graph:\n{graph_ctx}\n\n"
                f"Flow KB snippets:\n{kb_context}\n\n"
                f"Attached packets:\n{packet_text or '_none_'}\n"
            ),
        )

    def _from_llm(self, goal: str, run_type: str, data: dict[str, Any]) -> IntentClassification:
        mode = str(data.get("execution_mode") or "adhoc_existing")
        if mode not in {
            "morning_sanity",
            "regression_suite",
            "negative_suite",
            "adhoc_existing",
            "adhoc_parameterized",
            "incident_multi_flow",
            "new_feature",
            "discover",
        }:
            mode = "adhoc_existing"

        flow_ids = self._filter_primary([str(x) for x in data.get("flow_ids") or []])
        supporting = [str(x) for x in data.get("supporting_flow_ids") or []]
        if not flow_ids:
            flow_ids = self.graph.search_flows(goal, limit=3)
            flow_ids = self._filter_primary(flow_ids)

        params = data.get("params") if isinstance(data.get("params"), dict) else {}
        suite_ids = [str(x) for x in data.get("suite_ids") or []]

        return IntentClassification(
            goal=goal,
            run_type=run_type,
            execution_mode=mode,  # type: ignore[arg-type]
            capability=str(data.get("capability")) if data.get("capability") else None,
            suite_topic=str(data.get("suite_topic")) if data.get("suite_topic") else None,
            flow_ids=flow_ids,
            supporting_flow_ids=supporting or self.graph.supporting_for_query(goal),
            suite_ids=suite_ids,
            params=params,
            confidence=float(data.get("confidence") or 0.75),
            reasoning=str(data.get("reasoning") or f"LLM classified as {mode}"),
            classifier="llm",
        )

    def _classify_deterministic(
        self,
        goal: str,
        *,
        run_type: str,
        llm_error: str | None = None,
    ) -> IntentClassification:
        g = goal.lower()
        mode: ExecutionMode = "adhoc_existing"
        params: dict[str, Any] = {}
        capability: str | None = None
        flow_ids: list[str] = []
        supporting: list[str] = []
        suite_ids: list[str] = []
        reasoning = "Deterministic keyword + graph classification"

        if run_type in {"sanity", "scheduled"} or any(k in g for k in ("morning sanity", "morning check", "health check")) and "sanity" in g:
            if any(k in g for k in ("for ", "only ", "just ", "flow")):
                mode = "adhoc_existing"
                flow_ids = self.graph.flows_for_query_semantic(goal, limit=3) or self._filter_primary(self.graph.search_flows(goal, limit=2))
                reasoning = f"Sanity for specific flow(s): {', '.join(flow_ids) or 'searching KB'}"
            else:
                mode = "morning_sanity"
                suite_ids = ["SUITE-SANITY-MORNING"]
                flow_ids = self.graph.ready_flow_ids()
                reasoning = "Scheduled/morning sanity — all approved READY flows, no LLM at execution"
        elif any(k in g for k in ("regression", "full regression", "all tests")):
            mode = "regression_suite"
            suite_ids = ["SUITE-REGRESSION-FULL"]
            flow_ids = self.graph.ready_flow_ids()
            reasoning = "Full regression — all @regression tagged approved suites"
        elif any(k in g for k in ("negative", "invalid", "error case", "edge case", "wrong password", "bad sku")):
            mode = "negative_suite"
            if "login" in g:
                flow_ids = self._primary_or(["BF-LOGIN-001"])
            else:
                flow_ids = self.graph.flows_for_query_semantic(goal, limit=4)
            reasoning = "Negative / edge-case validation for matched flow(s)"
        elif any(k in g for k in ("sanity",)) and run_type != "sanity":
            mode = "adhoc_existing"
            flow_ids = self.graph.flows_for_query_semantic(goal, limit=2)
            reasoning = "Adhoc sanity check for matched flow(s)"
        elif any(k in g for k in ("new feature", "new banner", "ui change", "just added", "recently added")):
            mode = "new_feature"
            flow_ids = self._filter_primary(self.graph.search_flows(goal, limit=2))
            reasoning = "New/changed UI — run existing suite plus discovery crawl"
        elif any(k in g for k in ("payment", "checkout", "billing fail", "invoice fail", "payment fail", "checkout fail", "incident", "multiple flow", "end to end broken")):
            mode = "incident_multi_flow"
            caps = self.graph.match_capabilities(goal) or []
            capability = caps[0] if caps else None
            for cap in caps[:4]:
                flow_ids.extend(self.graph.flows_for_capability(cap))
            flow_ids.extend(self.graph.flows_for_query_semantic(goal, limit=6))
            flow_ids = list(dict.fromkeys(self._filter_primary(flow_ids)))
            reasoning = f"Keyword/capability traversal — payment/checkout/billing related suites ({capability or 'multi-cap'})"
        elif "discover" in g or "crawl" in g or "explore app" in g:
            mode = "discover"
            flow_ids = self._filter_primary(self.graph.search_flows(goal, limit=1))
            reasoning = "Discovery/crawl request"
        else:
            product_kind = resolve_product_intent_kind(goal)
            sku = extract_sku(goal)
            if product_kind == "view_product" or (sku and any(p in g for p in ("view product", "product detail", "open product"))):
                mode = "adhoc_parameterized"
                if sku:
                    params["sku"] = sku
                primary = primary_flow_for_product_kind("view_product")
                flow_ids = self._primary_or([primary])
                supporting = list(
                    dict.fromkeys(
                        [
                            *supporting_flows_for_product_kind("view_product"),
                            *[f for f in self.graph.supporting_for_query(goal) if f != primary],
                        ]
                    )
                )
                capability = "Product Management"
                reasoning = (
                    f"Product view/detail for SKU {sku}" if sku else "Product view/detail — execute View Product flow"
                )
            elif sku or product_kind == "search_product":
                mode = "adhoc_parameterized"
                if sku:
                    params["sku"] = sku
                flow_ids = self._primary_or([primary_flow_for_product_kind("search_product"), "BF-HOME-010-01"])
                capability = "Product Search"
                reasoning = f"Parameterized product search for SKU/item {sku or 'from request'}"
            elif "find price" in g or "findprice" in g:
                mode = "adhoc_existing"
                flow_ids = self._primary_or(["BF-FINDPRICE-004"])
                supporting = ["BF-FINDPRICE-004"] if "BF-FINDPRICE-004" not in flow_ids else []
                capability = "Pricing"
                reasoning = "Find Price module check (DRAFT KB supporting until SME approves)"
            elif "login" in g:
                flow_ids = self._primary_or(["BF-LOGIN-001"])
                capability = "Authentication"
            elif "logout" in g:
                flow_ids = self._primary_or(["BF-LOGOUT-002"])
                capability = "Authentication"
            elif "report" in g:
                flow_ids = self._primary_or(["BF-REPORTS-007"])
                capability = "Reporting"
            elif "rivaah" in g or "wedding" in g:
                flow_ids = self._primary_or(["BF-RIVAAH-005"])
                capability = "Rivaah"
            elif "invoice" in g or "billing" in g:
                flow_ids = self._primary_or(["BF-MANUAL-INVOICE-009"])
                capability = "Billing"
            elif "admin" in g:
                flow_ids = self._primary_or(["BF-ADMINISTRATION-009"])
                capability = "Administration"
            elif "stock" in g or "inventory" in g:
                flow_ids = self._primary_or(["BF-PRODUCT-STOCK-VISIBILITY-009"])
                capability = "Inventory"
            elif "catalogue" in g or "catalog" in g:
                flow_ids = self._primary_or(["BF-PRODUCT-CATALOGUE-006"])
                capability = "Product Management"
            elif "best deal" in g:
                flow_ids = self._primary_or(["BF-BEST-DEAL-008"])
                capability = "Product Browse"
            elif any(p in g for p in ("search product", "product search", "item search", "search sku")) or (
                "search" in g and "sku" in g
            ):
                flow_ids = self._primary_or([primary_flow_for_product_kind("search_product"), "BF-HOME-010-01"])
                capability = "Product Search"
                mode = "adhoc_parameterized" if sku else mode
                if sku:
                    params["sku"] = sku
            elif "search" in g and "product" not in g and "detail" not in g:
                flow_ids = self._primary_or(["BF-PRODUCT-003", "BF-HOME-010-01"])
                capability = "Product Search"
            elif "product" in g and any(p in g for p in ("view", "detail", "open")):
                flow_ids = self._primary_or([primary_flow_for_product_kind("view_product")])
                capability = "Product Management"
            elif "home" in g or "navigation" in g:
                flow_ids = self._primary_or(["BF-HOME-010"])
                capability = "Application Navigation"
            else:
                hits = self.graph.search_flows(goal, limit=2)
                flow_ids = self._filter_primary(hits)

        supporting = list(dict.fromkeys([*supporting, *self.graph.supporting_for_query(goal)]))
        if not capability and flow_ids:
            capability = self.graph.capability_for_flow(flow_ids[0])

        classifier = "deterministic" if not llm_error else f"deterministic_fallback({llm_error})"
        return IntentClassification(
            goal=goal,
            run_type=run_type,
            execution_mode=mode,
            capability=capability,
            flow_ids=flow_ids,
            supporting_flow_ids=supporting,
            suite_ids=suite_ids,
            params=params,
            confidence=0.65 if not llm_error else 0.5,
            reasoning=reasoning,
            classifier=classifier,
        )

    def _filter_primary(self, flow_ids: list[str]) -> list[str]:
        return [fid for fid in flow_ids if self.graph._is_primary(fid)]

    def _primary_or(self, candidates: list[str]) -> list[str]:
        primary = [f for f in candidates if self.graph._is_primary(f)]
        return primary or candidates[:1]

    def _apply_explicit_flow_precedence(self, intent: IntentClassification) -> IntentClassification:
        """User-stated canonical flow ids win over semantic product-kind routing."""
        explicit = extract_explicit_flow_ids(intent.goal)
        if not explicit:
            return intent
        primary: str | None = None
        for fid in explicit:
            if not self.graph._is_primary(fid):
                continue
            if self.graph.evaluate_execution(fid).executable:
                primary = fid
                break
        if not primary:
            return intent

        supporting = list(
            dict.fromkeys(
                [
                    *[f for f in explicit if f != primary],
                    *[f for f in intent.supporting_flow_ids if f != primary],
                    *[f for f in intent.flow_ids if f != primary],
                ]
            )
        )
        kind = resolve_product_intent_kind(intent.goal)
        if kind == "search_product" and primary != FLOW_SEARCH_PRODUCT:
            if FLOW_SEARCH_PRODUCT not in supporting:
                supporting.append(FLOW_SEARCH_PRODUCT)
        elif kind == "view_product" and primary != FLOW_VIEW_PRODUCT:
            if FLOW_SEARCH_PRODUCT not in supporting:
                supporting.append(FLOW_SEARCH_PRODUCT)

        params = dict(intent.params)
        sku = extract_sku(intent.goal)
        if sku and "sku" not in params:
            params["sku"] = sku
        mode = intent.execution_mode
        if sku and mode == "adhoc_existing":
            mode = "adhoc_parameterized"

        return intent.model_copy(
            update={
                "flow_ids": [primary],
                "supporting_flow_ids": supporting,
                "params": params,
                "execution_mode": mode,
                "reasoning": f"Explicit canonical flow id {primary} in user request",
            }
        )

    def _apply_product_capability_routing(self, intent: IntentClassification) -> IntentClassification:
        intent = self._apply_explicit_flow_precedence(intent)
        explicit = extract_explicit_flow_ids(intent.goal)
        if explicit and intent.flow_ids and intent.flow_ids[0] in explicit:
            return intent

        kind = resolve_product_intent_kind(intent.goal)
        if not kind:
            return intent
        primary = primary_flow_for_product_kind(kind)
        supporting = list(
            dict.fromkeys(
                [
                    *intent.supporting_flow_ids,
                    *supporting_flows_for_product_kind(kind),
                    *[f for f in intent.flow_ids if f != primary],
                ]
            )
        )
        capability = "Product Management" if kind == "view_product" else "Product Search"
        mode = intent.execution_mode
        if kind in {"search_product", "view_product"} and mode == "adhoc_existing":
            mode = "adhoc_parameterized"
        params = dict(intent.params)
        sku = extract_sku(intent.goal)
        if sku and "sku" not in params:
            params["sku"] = sku
        return intent.model_copy(
            update={
                "execution_mode": mode,
                "flow_ids": [primary],
                "supporting_flow_ids": supporting,
                "capability": capability,
                "params": params,
            }
        )


def _extract_param(text: str, pattern: str) -> str | None:
    m = re.search(pattern, text, re.IGNORECASE)
    return m.group(1) if m else None


def _extract_sku(goal: str) -> str | None:
    """Backward-compatible alias for knowledge_retriever and legacy imports."""
    return extract_sku(goal)
