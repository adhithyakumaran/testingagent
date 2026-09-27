"""Resolve product search vs product view intents for routing and GT matching."""

from __future__ import annotations

import re
from typing import Literal

ProductIntentKind = Literal["search_product", "view_product"]

FLOW_SEARCH_PRODUCT = "BF-PRODUCT-003"
FLOW_VIEW_PRODUCT = "BF-PRODUCT-004"

EXPLICIT_FLOW_ID_RE = re.compile(r"\b(BF-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b", re.IGNORECASE)

_VIEW_PHRASES = (
    "view product",
    "open product",
    "product detail",
    "product details",
    "detail page",
    "view item",
    "open item",
    "product view",
    "see product",
    "show product",
)

_SEARCH_PHRASES = (
    "search product",
    "product search",
    "search sku",
    "item search",
    "find product by sku",
    "find sku",
    "lookup sku",
    "look up sku",
)


def extract_explicit_flow_ids(goal: str) -> list[str]:
    """Canonical BF-* ids mentioned verbatim in the user request (order preserved)."""
    seen: set[str] = set()
    out: list[str] = []
    for match in EXPLICIT_FLOW_ID_RE.finditer(goal or ""):
        fid = match.group(1).upper()
        if fid in seen:
            continue
        seen.add(fid)
        out.append(fid)
    return out


def extract_sku(goal: str) -> str | None:
    m = re.search(
        r"\b(?:search\s+)?(?:sku|item\s*code|itemcode|product\s*id)[:\s#-]*([A-Za-z0-9-]{3,32})\b",
        goal,
        re.IGNORECASE,
    )
    if m:
        return m.group(1)
    m = re.search(
        r"\busing\s+sku\s+([A-Za-z0-9-]{3,32})\b",
        goal,
        re.IGNORECASE,
    )
    return m.group(1) if m else None


def resolve_product_intent_kind(goal: str) -> ProductIntentKind | None:
    g = goal.lower()
    if "best deal" in g:
        return None
    if any(p in g for p in _VIEW_PHRASES):
        return "view_product"
    if any(p in g for p in _SEARCH_PHRASES):
        return "search_product"
    if re.search(r"\bsearch\s+sku\b", g, re.IGNORECASE):
        return "search_product"
    if extract_sku(goal) and not any(p in g for p in _VIEW_PHRASES):
        return "search_product"
    return None


def primary_flow_for_product_kind(kind: ProductIntentKind) -> str:
    if kind == "view_product":
        return FLOW_VIEW_PRODUCT
    return FLOW_SEARCH_PRODUCT


def supporting_flows_for_product_kind(kind: ProductIntentKind) -> list[str]:
    if kind == "view_product":
        return [FLOW_SEARCH_PRODUCT]
    return []


def flow_id_from_test_case_id(test_case_id: str) -> str | None:
    m = re.match(r"^TC-(BF-[A-Z0-9-]+(?:-[A-Z0-9]+)*)-", test_case_id.strip(), re.IGNORECASE)
    return m.group(1).upper() if m else None
