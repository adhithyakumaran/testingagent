"""Regression tests for apps/automation/scripts/run-flow.mjs grep selection."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
AUTOMATION = REPO / "apps" / "automation"
SPEC = AUTOMATION / "tests" / "product" / "BF-PRODUCT-FLOWS.spec.ts"
GREP_MODULE = AUTOMATION / "scripts" / "run-flow-grep.mjs"


def _node_grep(flow_id: str) -> str:
    script = (
        "import { buildFlowGrep } from './scripts/run-flow-grep.mjs';"
        f"console.log(buildFlowGrep('positive', {flow_id!r}));"
    )
    out = subprocess.check_output(
        ["node", "--input-type=module", "-e", script],
        cwd=AUTOMATION,
        text=True,
    )
    return out.strip()


def _collect_playwright_titles() -> list[str]:
    text = SPEC.read_text(encoding="utf-8")
    describe_tags = re.findall(r"test\.describe\('([^']+)'", text)
    test_titles = re.findall(r"test\('([^']+)'", text)
    titles: list[str] = []
    for i, t in enumerate(test_titles):
        block_tag = describe_tags[i] if i < len(describe_tags) else ""
        titles.append(f"{block_tag} {t}")
    return titles


def _grep_matches(grep: str, haystack: str) -> bool:
    return re.search(grep, haystack) is not None


@pytest.mark.parametrize(
    ("flow_id", "expected_tc"),
    [
        ("BF-PRODUCT-003", "TC-BF-PRODUCT-003-P01"),
        ("BF-PRODUCT-004", "TC-BF-PRODUCT-004-P01"),
    ],
)
def test_positive_flow_grep_selects_primary_test(flow_id: str, expected_tc: str):
    grep = _node_grep(flow_id)
    titles = _collect_playwright_titles()
    matched = [t for t in titles if _grep_matches(grep, t)]
    assert len(matched) == 1, f"grep={grep!r} matched={matched!r}"
    assert expected_tc in matched[0]


def test_bf_product_003_and_004_grep_are_mutually_exclusive():
    grep_003 = _node_grep("BF-PRODUCT-003")
    grep_004 = _node_grep("BF-PRODUCT-004")
    titles = _collect_playwright_titles()
    only_003 = [t for t in titles if _grep_matches(grep_003, t)]
    only_004 = [t for t in titles if _grep_matches(grep_004, t)]
    assert only_003 == [t for t in titles if "TC-BF-PRODUCT-003-P01" in t]
    assert only_004 == [t for t in titles if "TC-BF-PRODUCT-004-P01" in t]
    assert not set(only_003) & set(only_004)


def test_bf_product_004_grep_requires_positive_tag():
    grep = _node_grep("BF-PRODUCT-004")
    assert "@positive" in grep
    assert "@BF-PRODUCT-004".replace("@", "") in grep or "BF-PRODUCT-004" in grep


def test_bf_home_010_01_positive_grep_selects_p01_only():
    home_spec = AUTOMATION / "tests" / "home" / "BF-HOME-010-01.spec.ts"
    grep = _node_grep("BF-HOME-010-01")
    text = home_spec.read_text(encoding="utf-8")
    describe = re.search(r"test\.describe\('([^']+)'", text)
    tests = re.findall(r"test\('([^']+)'", text)
    assert describe is not None
    matched = [
        f"{describe.group(1)} {t}"
        for t in tests
        if re.search(grep, f"{describe.group(1)} {t}")
    ]
    assert len(matched) == 1
    assert "TC-BF-HOME-010-01-P01" in matched[0]
