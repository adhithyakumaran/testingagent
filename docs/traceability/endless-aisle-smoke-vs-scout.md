# Endless Aisle — Teammate Smoke vs ScoutAI Traceability

**Phase:** Analysis only (documentation).  
**Source package:** `docs/Endless Aisle-main (1).zip` (teammate Playwright automation).  
**ScoutAI baseline:** Repository `main` at time of analysis — `data/discovery-kb/`, `apps/automation/test-design/`, `apps/automation/tests/`.  
**Primary executable evidence (teammate):** `tests/smoke/smoke.spec.ts`, `smoke.data.ts`, `smoke.page.ts`.  
**Secondary teammate pack:** `tests/ProductCatalogue/ProductCatalogue.spec.ts` (regression; overlaps Smoke Flow 3).

**Out of scope for this document:** Changing flow YAML, test cases, Playwright specs, `capabilities.yaml`, runtime, UI, or execution behavior. **No credentials** from the teammate package are reproduced here.

---

## Terminology (preserve these layers)

| Layer | ScoutAI location | Meaning |
|-------|------------------|---------|
| **Business flow** | `data/discovery-kb/flows/BF-*.yaml`, `flows/index.yaml` | SME-ready capability; stable **flow ID** (e.g. `BF-HOME-010`). |
| **Scenario** | `apps/automation/test-design/flows/<flow-id>/scenarios.yaml` | Approved behavioral path (`SC-*`). |
| **Test case** | `apps/automation/test-design/flows/<flow-id>/test-cases.yaml` | Executable intent (`TC-*`); links to scenario. |
| **Playwright test** | `apps/automation/tests/**/*.spec.ts` | What CI/local automation actually runs. |
| **KB / discovery-only** | `data/discovery-kb/kb/*.json`, recordings, draft flows | Observed or migrated knowledge **without** matching Playwright. |

A flow can be **READY** in the KB while Playwright coverage is **partial** or **absent**.

---

## Executive summary

The teammate package implements **four smoke flows** in `smoke.spec.ts` (plus a separate Product Catalogue regression suite). ScoutAI already has **READY business flows** for most Endless Aisle capabilities (login, home hub, item search, best deal, stock visibility, Rivaah, reports, administration, product catalogue, etc.), but **Playwright depth is much thinner** than the teammate smoke tests.

**Largest gaps:**

1. **Smoke Flow 1** — Home navigation hub (28 tiles: count, names, images, order, per-tile navigation). Scout documents many destinations under **BF-HOME-010** but does **not** automate V2–V6.
2. **Smoke Flow 3** — **All Products → category → sort → Export List → WhatsApp/PDF share** on the **standard product listing**. This is **not** the same as **BF-PRODUCT-CATALOGUE-006** (Home **Product Catalogue** static PDF cards) or **BF-REPORTS-007** (reports menu export).
3. **Smoke Flow 4** — **Customer selection → factory booking → POSS order details** after Item Search. Scout covers **Item Search → result** only; `data/discovery-kb/capabilities.yaml` lists **Checkout / Customer Order** as **NOT_STARTED**.

**Path discipline (non-negotiable):** These three journeys end on product detail or order context but use **different UI paths** — do not merge them into one “product detail” flow:

- **Best Deal → SKU → Product Detail**
- **Item Search → SKU → Product Detail**
- **All Products → Category → Product Detail**

**Home hub rule:** Smoke Flow 1 is **one navigation aggregate** under **BF-HOME-010**. **Do not create 28 separate business flows** for the 28 tiles.

**Two genuinely new capability areas** (not satisfied by extending login, logout, or existing READY product flows alone):

1. **Listing Export & Share** — Export List basket, WhatsApp catalogue share, PDF share from **All Products / standard listing**.
2. **Customer Order / Checkout → Factory Booking → POSS** — customer attach, factory booking, order/POSS details (Flow 4 tail).

---

## Four teammate smoke flows

| ID | Name (teammate) | Spec reference | Scout primary mapping |
|----|-----------------|----------------|---------------------|
| **SF-1** | Endless Aisle — Home Navigation Hub | `smoke.spec.ts` — V0–V6 + logout | **BF-HOME-010**, **BF-LOGIN-001**, **BF-LOGOUT-002** |
| **SF-2** | Best Deal random SKU search and detail validation | `smoke.spec.ts` — V0–V4 | **BF-BEST-DEAL-008**, **BF-HOME-010** (entry) |
| **SF-3** | All Products category, sorting, export, WhatsApp and PDF share | `smoke.spec.ts` — V0–V7 | **BF-BROWSE-009**, **BF-CAT-EAR-010** (DRAFT), **BF-HOME-010** (entry) |
| **SF-4** | Item Search, customer selection, factory booking and POSS order details | `smoke.spec.ts` — V0–V4 + customer/factory/POSS | **BF-HOME-010-01**, **BF-PRODUCT-003**; checkout **gap** |

---

## Master traceability matrix

| # | Team smoke | Team step / case | Scout flow ID | Scout scenario / TC | Playwright | Coverage | Path match | Evidence | Recommended action |
|---|------------|------------------|---------------|---------------------|------------|----------|------------|----------|-------------------|
| 1 | SF-1 | V0 login | BF-LOGIN-001 | TC-BF-LOGIN-001-P01 | `tests/auth/BF-LOGIN-001.spec.ts` | COVERED | EXACT | `smoke.spec.ts` L23–27 | KEEP_EXISTING |
| 2 | SF-1 | V1 home grid / user menu | BF-HOME-010 | TC-BF-HOME-010-P01 | `tests/home/BF-HOME-010.spec.ts` | PARTIALLY_COVERED | EXACT | L29–32 | EXTEND_EXISTING_FLOW |
| 3 | SF-1 | V2 tile count = 28 | BF-HOME-010 | SC-BF-HOME-010-001 (cards available) | None | NOT_COVERED (PW) | EXACT | L34–43; `smoke.data.ts` | ADD_TEST_CASE |
| 4 | SF-1 | V3 all tile names | BF-HOME-010 | Partial SC-BF-HOME-010-* | None | PARTIALLY_COVERED (KB) | UNKNOWN | L45–48 | EXTEND_EXISTING_FLOW + SME tile list |
| 5 | SF-1 | V4 tile images | BF-HOME-010 | — | None | NOT_COVERED | EXACT | L50–53 | ADD_TEST_CASE |
| 6 | SF-1 | V5 tile order | BF-HOME-010 | — | None | NOT_COVERED | UNKNOWN | L55–60 | ADD_TEST_CASE (after SME) |
| 7 | SF-1 | V6 each tile navigates (28) | BF-HOME-010 (+ child refs) | SC-BF-HOME-010-002…025; `BF-HOME-010.yaml` `observed_scenarios` | TC-BF-HOME-010-E01 only (Item Search card) | PARTIALLY_COVERED | MIXED | L62–76; `HOME_TILES` | EXTEND_EXISTING_FLOW (parametric V6) |
| 8 | SF-1 | Logout | BF-LOGOUT-002 | TC-BF-LOGOUT-002-P01 | `tests/auth/BF-LOGOUT-002.spec.ts` | COVERED | EXACT | L78–79 | NO_ACTION |
| 9 | SF-2 | V0–V1 login / home menu | BF-LOGIN-001, BF-HOME-010 | As above | As above | DUPLICATE | EXACT | L86–92 | NO_ACTION |
| 10 | SF-2 | V2 open Best Deal from home | BF-BEST-DEAL-008 | SC-BF-HOME-010-007; TC-BF-BEST-DEAL-008-P01 | `BF-PRODUCT-FLOWS.spec.ts` — `product-discount` load only | PARTIALLY_COVERED | EXACT entry | L94–96 | EXTEND_EXISTING_FLOW |
| 11 | SF-2 | V3–V4 SKU in Best Deal listing → detail | BF-BEST-DEAL-008 | TC-BF-BEST-DEAL-008-P01 (intent) | No listing SKU test; BF-PRODUCT-004 uses Item Search | NOT_COVERED (PW) | DIFFERENT_UI_PATH vs Item Search | L98–102 | ADD_SCENARIO + ADD_TEST_CASE |
| 12 | SF-3 | V0–V1 login / home | BF-LOGIN-001, BF-HOME-010 | As above | As above | DUPLICATE | EXACT | L109–112 | NO_ACTION |
| 13 | SF-3 | V2 All Products + categories | BF-BROWSE-009, BF-CAT-EAR-010 (DRAFT) | SC-BF-HOME-010-002 | None for `select-category` journey | PARTIALLY_COVERED (KB) | EXACT | L114–116 | EXTEND_EXISTING_FLOW |
| 14 | SF-3 | V2.1 Earrings, filters, skip | BF-CAT-EAR-010 | Draft `business_flow` | None | NOT_COVERED | EXACT | L118–125 | ADD_TEST_CASE |
| 15 | SF-3 | V3 price sort | BF-CAT-EAR-010 / browse | — | Teammate `ProductCatalogue.spec.ts` only | PARTIALLY_COVERED (teammate only) | EXACT listing | L127–134 | ADD_TEST_CASE |
| 16 | SF-3 | V4 Export List | — (no READY BF) | — | None; recording `report_58aa.md` | NOT_COVERED | UNKNOWN | L136–139 | New capability: Listing Export & Share |
| 17 | SF-3 | V5 listing SKU → detail → back | BF-PRODUCT-004 | TC-BF-PRODUCT-004-P01 | Via Item Search in PW | PARTIALLY_COVERED | DIFFERENT_UI_PATH | L141–144 | ADD_SCENARIO on browse flow |
| 18 | SF-3 | V6 unselect export | — | — | None | NOT_COVERED | UNKNOWN | L146–148 | Listing Export & Share |
| 19 | SF-3 | V7 WhatsApp + PDF share (listing) | Not BF-PRODUCT-CATALOGUE-006 | BF-REPORTS-007 (reports export — different) | None for listing share | NOT_COVERED | DIFFERENT_UI_PATH | L150–155 | Listing Export & Share |
| 20 | SF-4 | V0–V1 login / home | BF-LOGIN-001, BF-HOME-010 | As above | As above | DUPLICATE | EXACT | L166–171 | NO_ACTION |
| 21 | SF-4 | V2 All Products → Earrings → product (SKU discovery) | BF-BROWSE-009, BF-CAT-EAR-010 | Draft | None | NOT_COVERED (PW) | DIFFERENT_UI_PATH vs Item Search leg | L173–178 | EXTEND_EXISTING_FLOW |
| 22 | SF-4 | V3–V4 Item Search + SKU | BF-HOME-010-01, BF-PRODUCT-003 | TC-BF-HOME-010-01-P01 | `BF-HOME-010-01.spec.ts`, `BF-PRODUCT-FLOWS.spec.ts` | COVERED (search) | EXACT | L180–185 | KEEP_EXISTING |
| 23 | SF-4 | Customer select (without payment) | — (Checkout NOT_STARTED) | — | None | NOT_COVERED | UNKNOWN | L187–188; `capabilities.yaml` | Customer Order / Checkout capability |
| 24 | SF-4 | Factory booking | BF-HOME-010-01 (edge KB only) | SC-BF-HOME-010-01-007 | None | PARTIALLY_COVERED (KB) | DIFFERENT_UI_PATH | L190–191 | Checkout capability |
| 25 | SF-4 | POSS / order details | — | — | None | NOT_COVERED | UNKNOWN | L193–194 | Checkout capability |

---

## A. Exact covered mappings

| Teammate behavior | Scout business flow | Scenario / TC | Playwright |
|-------------------|---------------------|---------------|------------|
| Login → land on home | BF-LOGIN-001 | TC-BF-LOGIN-001-P01 | `BF-LOGIN-001.spec.ts` |
| Logout after smoke | BF-LOGOUT-002 | TC-BF-LOGOUT-002-P01 | `BF-LOGOUT-002.spec.ts` |
| Home loads with cards (minimal) | BF-HOME-010 | TC-BF-HOME-010-P01 | `BF-HOME-010.spec.ts` |
| Home → Item Search → search result | BF-HOME-010-01, BF-PRODUCT-003 | TC-BF-HOME-010-01-P01 | `BF-HOME-010-01.spec.ts` |
| Item Search → product detail (param SKU) | BF-PRODUCT-004 | TC-BF-PRODUCT-004-P01 | `BF-PRODUCT-FLOWS.spec.ts` (Item Search path) |
| Stock Visibility tile (inventory) | BF-PRODUCT-STOCK-VISIBILITY-009 | TC-BF-PRODUCT-STOCK-VISIBILITY-009-P01 | `BF-PRODUCT-STOCK-VISIBILITY-009.spec.ts` |
| Rivaah home entry | BF-RIVAAH-005 | (Rivaah test-design) | `BF-RIVAAH-005.spec.ts` |
| Best Deal page reachable | BF-BEST-DEAL-008 | TC-BF-BEST-DEAL-008-P01 (shallow) | `BF-PRODUCT-FLOWS.spec.ts` — page load |
| Reports, Administration, Manual Invoice, Product Catalogue (separate home cards) | BF-REPORTS-007, BF-ADMINISTRATION-009, BF-MANUAL-INVOICE-009, BF-PRODUCT-CATALOGUE-006 | Per-flow TC-P01 | Dedicated specs (not teammate smoke paths) |

---

## B. Partial coverage

| Area | KB / scenario | Playwright gap |
|------|---------------|----------------|
| SF-1 Home hub | BF-HOME-010 scenarios for many tiles; not all 28 teammate tiles in `observed_scenarios` | V2–V6 not automated; only P01 + E01 (one card) |
| SF-2 Best Deal | BF-BEST-DEAL-008 READY; home entry SC-007 | No home → listing SKU → discount detail |
| SF-3 All Products browse | BF-BROWSE-009, BF-CAT-EAR-010 DRAFT | No `select-category` journey, sort, export, share |
| SF-4 Item Search | BF-HOME-010-01 READY | Factory edge in SC-BF-HOME-010-01-007 only (KB); no booking/POSS |
| Product detail | BF-PRODUCT-004 READY | Implemented only via **Item Search**, not Best Deal or All Products |
| Teammate ProductCatalogue pack | Overlaps SF-3 browse/sort/detail | Exists only in teammate repo, not Scout `apps/automation/tests` |

---

## C. Missing automation

- SF-1: tile count, names, images, order, full V6 loop (28 navigations).
- SF-2: SKU search within **Best Deal listing** and discount product detail assertions.
- SF-3: category selection, filter/skip flow, sort assertions, Export List add/remove, listing WhatsApp/PDF share.
- SF-4: customer selection, factory booking, POSS order details.
- Most home tiles: no Playwright tile-navigation tests except partial coverage (Item Search, Stock Visibility, Rivaah, Reports, Admin, etc.).

---

## D. Different UI paths (explicit)

These journeys must remain **separate scenarios** under the correct business flow. **Do not** treat “reached product detail” as proof of path equivalence.

| Path | Entry | Scout flow ownership | Teammate smoke |
|------|--------|----------------------|----------------|
| **Best Deal → SKU → Detail** | Home → Best Deal → `product-discount` listing → SKU → discount detail | **BF-BEST-DEAL-008** | SF-2 |
| **Item Search → SKU → Detail** | Home → Item Search → P6 search → result/detail | **BF-HOME-010-01**, **BF-PRODUCT-003**, **BF-PRODUCT-004** | SF-4 (search leg); also Scout default for TC-004 |
| **All Products → Category → Detail** | Home → All Products → `select-category` → category → listing → detail | **BF-BROWSE-009**, **BF-CAT-EAR-010** (draft) | SF-3, SF-4 (discovery leg) |

---

## E. Duplicate / redundant coverage

- **Login + home menu** repeated in SF-2, SF-3, SF-4 → map to **BF-LOGIN-001** / **BF-HOME-010** only; **NO_ACTION** for duplicate business flows.
- **Logout** at end of SF-1 / SF-3 → **BF-LOGOUT-002**; do not add smoke-specific logout flows.
- **Product detail** must not be a single flow: extending **BF-PRODUCT-004** alone would **duplicate** Best Deal and All Products paths — add **path-specific scenarios** instead.
- Teammate **ProductCatalogue.spec.ts** is largely **DUPLICATE** automation evidence for SF-3 (Earrings browse/sort/detail), not a separate business capability.

---

## F. Flows to extend (do not replace)

| Flow ID | Extend for |
|---------|------------|
| **BF-HOME-010** | SF-1 aggregate: V2–V6 parametric data for 28 tiles (**one** business flow, many scenarios/TCs). |
| **BF-BEST-DEAL-008** | SF-2: home → Best Deal → listing SKU → discount detail. |
| **BF-BROWSE-009** / **BF-CAT-EAR-010** | SF-3/SF-4 All Products legs; promote draft → READY with SME. |
| **BF-HOME-010-01** | Optional clearer link from Item Search to factory **edge** (SC-007); do not absorb full Checkout. |

**Do not create 28 Home business flows.** The 28 teammate tiles are **navigation destinations** under **BF-HOME-010**, implemented as scenarios/test cases and optional data-driven Playwright — not `BF-HOME-TILE-01` … `BF-HOME-TILE-28`.

---

## G. Genuinely new business capabilities

### 1. Listing Export & Share

**Teammate evidence:** SF-3 V4, V6, V7 — Export List, WhatsApp catalogue share, PDF share on **standard product listing** (All Products path).

**Not the same as:**

- **BF-PRODUCT-CATALOGUE-006** — Home **Product Catalogue** card → static catalogue PDFs / collection pages (`/product-catalogue`).
- **BF-REPORTS-007** — Reports menu **PDF/WhatsApp Export Report** (order-tracking / reporting context).

**Scout today:** Discovery recording mentions “Export List” (`data/discovery-kb/recordings/report_58aa.md`); **no READY flow**, **no Playwright**.

**Recommendation:** Define a new business capability (name TBD by SME, e.g. under Product Browse) for **listing export basket and share channels**.

### 2. Customer Order / Checkout → Factory Booking → POSS

**Teammate evidence:** SF-4 — customer selection, factory booking (`NO_STOCK`), POSS order details.

**Scout today:** `data/discovery-kb/capabilities.yaml` — **Checkout: NOT_STARTED**, note *“Customer Order flow still gap for SME”*. Item Search scenario **SC-BF-HOME-010-01-007** documents factory/stock edge (MyCrown portal option) — **KB only**, not Flow 4’s completed booking/POSS path.

**Recommendation:** New checkout/customer-order flow family; Item Search remains **entry**, not a substitute for checkout.

---

## Home 28-tile annex (SF-1 V6 — navigation only)

Each row is **coverage of a home tile destination**, not a new business flow ID.

| # | Teammate tile | KB / scenario (BF-HOME-010 or related) | Playwright |
|---|---------------|----------------------------------------|------------|
| 1 | All Products | SC-BF-HOME-010-002 | No |
| 2 | Item Search | SC-BF-HOME-010-003, BF-HOME-010-01 | E01 + 010-01 spec |
| 3 | Rivaah | SC-BF-HOME-010-004 → BF-RIVAAH-005 | `BF-RIVAAH-005.spec.ts` |
| 4 | Customer Order | Components / discovery; **no** `observed_scenario` | None |
| 5 | Best Deal | SC-BF-HOME-010-007 | Page load only |
| 6 | Smart Image Search | SC-BF-HOME-010-008 | None |
| 7 | ECOM Stock Visibility | Recordings; weak in `observed_scenarios` | None |
| 8 | Find Price | SC-BF-HOME-010-009; BF-FINDPRICE-004 DRAFT | None |
| 9 | Estimation Slip | SC-BF-HOME-010-010 | None |
| 10 | Solitaire UIN | SC-BF-HOME-010-011 | None |
| 11 | Gold Coin Stock Visibility | SC-BF-HOME-010-012 | None |
| 12 | Stock Visibility | SC-BF-HOME-010-014 → BF-PRODUCT-STOCK-VISIBILITY-009 | Inventory spec |
| 13 | My Store Stock | SC-BF-HOME-010-015 | None |
| 14 | Open IBT Action - Urgent | `discovery_report.json`; not in scenarios.yaml | None |
| 15 | Report | SC-BF-HOME-010-006 → BF-REPORTS-007 | Reports spec |
| 16 | Customer Wishlist | SC-BF-HOME-010-016 | None |
| 17 | Solitaire Products | SC-BF-HOME-010-017 | None |
| 18 | New Collections | SC-BF-HOME-010-018 | None |
| 19 | High Value Studded | In `BF-HOME-010.yaml` components | None; SME mismatch vs “Look of the Week” scenario |
| 20 | Silver Collections | SC-BF-HOME-010-020 | None |
| 21 | Size Based Search | SC-BF-HOME-010-021 | None |
| 22 | Engagement -Min 7 Day Delivery | **Not** in home `observed_scenarios` | None; vs BF-RIVAAH-005-03 (Rivaah submenu) |
| 23 | National/Regional Best Seller | SC-BF-HOME-010-022 | None |
| 24 | Browse Store Stock | Discovery body text | None |
| 25 | KVI&FMC | BF-ADMINISTRATION-009 sub-function | Admin spec (not home tile loop) |
| 26 | Shubh Gold Express | Administration sub | None |
| 27 | Home Delivery | Administration sub | None |
| 28 | Chatbot | Administration sub | None |

**All 28 teammate tile names** appear in teammate `smoke.data.ts`. In Scout KB, **all are referenced in discovery or BF-HOME-010 material**, but **not all** have matching **`observed_scenarios`** or Playwright. SME reconciliation needed for **Customer Order**, **ECOM**, **IBT**, **Engagement** (home tile), **High Value Studded** vs **Look of the Week**, and admin-nested tiles as **home V6** assertions.

---

## Best Deal path comparison

| Step | Teammate SF-2 | ScoutAI |
|------|---------------|---------|
| Entry | Home → Best Deal tile | KB: SC-BF-HOME-010-007; PW: direct `product-discount` URL |
| Search context | SKU in **Best Deal listing** (`FLOW2.staticSku`) | **Not automated** |
| Detail page | Discount product detail for SKU | **BF-PRODUCT-004** automates detail via **Item Search** — **wrong path** for SF-2 parity |
| Flow ID | — | **BF-BEST-DEAL-008** (extend; do not duplicate as BF-PRODUCT-004) |

---

## All Products path comparison

| Step | Teammate SF-3 / SF-4 (discovery) | ScoutAI |
|------|----------------------------------|---------|
| Entry | Home → All Products | SC-BF-HOME-010-002 → `select-category` |
| Category | Earrings + filters + skip | BF-CAT-EAR-010 draft |
| Sort | Low/High on listing | Teammate only |
| Export / share | Export List, WhatsApp, PDF on listing | **Not in Scout** (see Listing Export & Share) |
| Detail | From listing SKU | BF-PRODUCT-004 uses Item Search — **different path** |
| vs Product Catalogue | **Not used** in smoke | BF-PRODUCT-CATALOGUE-006 = separate home card |

---

## Item Search → Customer → Factory → POSS gap

| Step | Teammate SF-4 | ScoutAI |
|------|---------------|---------|
| Discover SKU | All Products → Earrings → product (optional path) | Not automated |
| Item Search | Search + select SKU | **COVERED** — BF-HOME-010-01, BF-PRODUCT-003 |
| Customer | Select customer for without payment | **NOT_STARTED** (Checkout) |
| Factory | Book factory without payment | KB edge SC-BF-HOME-010-01-007 only |
| POSS | Order details assertion | **No flow, no Playwright** |

---

## Export / WhatsApp / PDF gap

| Feature | Teammate | ScoutAI READY flow | Scout Playwright |
|---------|----------|--------------------|------------------|
| Export List (listing basket) | SF-3 V4, V6 | None | None |
| WhatsApp share (listing catalogue) | SF-3 V7 | None (reports export is different) | None |
| PDF share (listing) | SF-3 V7 | BF-PRODUCT-CATALOGUE-006 is **catalogue card** PDFs | Catalogue page load only |
| Reports PDF/WhatsApp export | Not in smoke | BF-REPORTS-007 scenario | Reports spec (partial) |

---

## Final recommended additions (documentation phase only — no implementation)

1. **BF-HOME-010:** Data-driven scenarios/TCs for SF-1 V2–V6 (28 tile rows in test data, **one** flow ID).
2. **BF-BEST-DEAL-008:** Scenario “Home → Best Deal → listing SKU → discount detail” (distinct from BF-PRODUCT-004).
3. **BF-BROWSE-009 / BF-CAT-EAR-010:** SME promotion to READY; scenarios for Earrings, sort, listing → detail.
4. **New capability — Listing Export & Share:** Export List, WhatsApp, PDF on standard listing; SME naming and flow ID.
5. **New capability — Customer Order / Checkout:** Customer attach → factory booking → POSS; align with `capabilities.yaml` Checkout gap.
6. **SME alignment:** Tile list (High Value Studded vs Look of the Week, Engagement home tile vs Rivaah Engagement Rings, ECOM vs Stock Visibility); add missing `observed_scenarios` for Customer Order, IBT, Browse Store Stock.
7. **Credentials:** Use Scout `EA_*` / `QA_PARAM_SKU` patterns only when implementing automation later — never copy teammate `.env` values into KB or docs.

---

## References (repository paths)

| Artifact | Path |
|----------|------|
| Teammate smoke (in repo) | `docs/Endless Aisle-main (1).zip` |
| Flow index | `data/discovery-kb/flows/index.yaml` |
| Home navigation KB | `data/discovery-kb/flows/BF-HOME-010.yaml` |
| Capabilities map | `data/discovery-kb/capabilities.yaml` |
| Home scenarios | `apps/automation/test-design/flows/BF-HOME-010/scenarios.yaml` |
| Scout Playwright tests | `apps/automation/tests/` |

---

*Document version: 1.0 — traceability phase, analysis source of truth for subsequent implementation planning.*
