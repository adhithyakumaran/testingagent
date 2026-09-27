/**
 * BF-HOME-010 — Home navigation tile matrix (Smoke Flow 1 V2–V6).
 * Sources: teammate smoke.data.ts (navigation contracts), Scout KB scenarios (SC-BF-HOME-010-*).
 * See docs/traceability/endless-aisle-smoke-vs-scout.md
 */

export const HOME_TILE_EXPECTED_COUNT = 28;

export type HomeTileAssertKind = 'urlIncludes' | 'visibleText' | 'containsText';

export type HomeTileNavigationContract = {
  assertKind: HomeTileAssertKind;
  /** URL fragment, visible text, or substring to assert on destination. */
  assertValue: string;
  opensNewTab?: boolean;
  /** Teammate locator token name (reference only — resolved in HomePage). */
  teammateLocatorKey?: string;
};

export type HomeTileAutomationStatus = 'automated' | 'sme_required';

export type HomeTileMatrixEntry = {
  order: number;
  name: string;
  automation: HomeTileAutomationStatus;
  /** Scout observed scenario when mapped (not invented). */
  scoutScenarioId?: string;
  scoutDestination?: string;
  navigation?: HomeTileNavigationContract;
  returnToHomeAfterNav: boolean;
  smeFlags?: string[];
  notes?: string;
};

/** SME reconciliation flags — do not automate navigation until resolved. */
export const HOME_TILE_SME_FLAGS = {
  HIGH_VALUE_VS_LOOK_OF_WEEK: 'high_value_studded_vs_look_of_the_week',
  ENGAGEMENT_HOME_VS_RIVAAH: 'engagement_home_tile_vs_rivaah_engagement_rings',
  CUSTOMER_ORDER_GAP: 'customer_order_checkout_gap',
  ECOM_STOCK_VISIBILITY: 'ecom_stock_visibility_kb_gap',
  IBT_NO_OBSERVED_SCENARIO: 'open_ibt_no_scout_observed_scenario',
  BROWSE_STORE_STOCK: 'browse_store_stock_external_popup',
  ADMIN_NESTED_TILE: 'administration_nested_home_tile',
} as const;

const SME_TILE_NAMES = new Set<string>([
  'High Value Studded',
  'Engagement -Min 7 Day Delivery',
  'Customer Order',
  'ECOM Stock Visibility',
  'Open IBT Action - Urgent',
  'Browse Store Stock',
  'KVI&FMC',
  'Shubh Gold Express',
  'Home Delivery',
  'Chatbot',
]);

type TeammateTileSeed = {
  name: string;
  assertType: 'urlIncludes' | 'visible' | 'containsText';
  assertValue: string;
  opensNewTab?: boolean;
  locatorKey?: string;
  scoutScenarioId?: string;
  scoutDestination?: string;
  smeFlags?: string[];
  notes?: string;
};

/** Teammate Smoke Flow 1 order + contracts (smoke.data.ts HOME_TILES). */
const TEAMMATE_TILE_SEEDS: TeammateTileSeed[] = [
  {
    name: 'All Products',
    assertType: 'urlIncludes',
    assertValue: 'select-category',
    scoutScenarioId: 'SC-BF-HOME-010-002',
    scoutDestination: '/ords/r/tjdcom/ea/select-category',
  },
  {
    name: 'Item Search',
    assertType: 'containsText',
    assertValue: 'Product Search',
    locatorKey: 'itemSearchHeading',
    scoutScenarioId: 'SC-BF-HOME-010-003',
    scoutDestination: '/ords/r/tjdcom/ea/product-detail-item-search',
  },
  {
    name: 'Rivaah',
    assertType: 'visible',
    assertValue: 'Rivaah',
    locatorKey: 'rivaahMenuItem',
    scoutScenarioId: 'SC-BF-HOME-010-004',
    scoutDestination: '/ords/r/tjdcom/ea/rivaah',
  },
  {
    name: 'Customer Order',
    assertType: 'visible',
    assertValue: 'Customer Order Management',
    locatorKey: 'customerOrderHeading',
    smeFlags: [HOME_TILE_SME_FLAGS.CUSTOMER_ORDER_GAP],
    notes: 'Teammate asserts heading; Scout capabilities.yaml Checkout NOT_STARTED.',
  },
  {
    name: 'Best Deal',
    assertType: 'visible',
    assertValue: 'BRAND',
    locatorKey: 'brandInCurrentFilters',
    scoutScenarioId: 'SC-BF-HOME-010-007',
    scoutDestination: '/ords/r/tjdcom/ea/product-discount',
  },
  {
    name: 'Smart Image Search',
    assertType: 'containsText',
    assertValue: 'Search With Image',
    locatorKey: 'smartImageSearchHeading',
    scoutScenarioId: 'SC-BF-HOME-010-008',
    scoutDestination: '/ords/r/tjdcom/ea/smart-image-search1',
  },
  {
    name: 'ECOM Stock Visibility',
    assertType: 'visible',
    assertValue: 'Item Search',
    locatorKey: 'itemSearchTextbox',
    smeFlags: [HOME_TILE_SME_FLAGS.ECOM_STOCK_VISIBILITY],
    notes: 'Not in BF-HOME-010 observed_scenarios; distinct from Stock Visibility tile.',
  },
  {
    name: 'Find Price',
    assertType: 'visible',
    assertValue: 'LOT Number',
    locatorKey: 'lotNumberTextbox',
    scoutScenarioId: 'SC-BF-HOME-010-009',
    scoutDestination: '/ords/r/tjdcom/ea/find-price',
  },
  {
    name: 'Estimation Slip',
    assertType: 'containsText',
    assertValue: 'Estimation Slip',
    locatorKey: 'estimationSlipHeading',
    scoutScenarioId: 'SC-BF-HOME-010-010',
    scoutDestination: '/ords/r/tjdcom/ea/estimation-slip',
  },
  {
    name: 'Solitaire UIN',
    assertType: 'containsText',
    assertValue: 'UIN Search',
    locatorKey: 'solitaireUinHeading',
    scoutScenarioId: 'SC-BF-HOME-010-011',
    scoutDestination: '/ords/r/tjdcom/ea/solitaire-uin-search',
  },
  {
    name: 'Gold Coin Stock Visibility',
    assertType: 'visible',
    assertValue: 'Gold Karatage',
    locatorKey: 'goldKaratageHeading',
    scoutScenarioId: 'SC-BF-HOME-010-012',
    scoutDestination: '/ords/r/tjdcom/ea/gold-coin-stock-visibility',
  },
  {
    name: 'Stock Visibility',
    assertType: 'visible',
    assertValue: 'Item Search',
    locatorKey: 'itemSearchTextbox',
    scoutScenarioId: 'SC-BF-HOME-010-014',
    scoutDestination: '/ords/r/tjdcom/ea/product-stock-visibility',
  },
  {
    name: 'My Store Stock',
    assertType: 'visible',
    assertValue: 'Make your own catalogue',
    locatorKey: 'makeOwnCatalogueButton',
    scoutScenarioId: 'SC-BF-HOME-010-015',
    scoutDestination: '/ords/r/tjdcom/ea/my-store-stock',
  },
  {
    name: 'Open IBT Action - Urgent',
    assertType: 'visible',
    assertValue: 'Inter Boutique Transfer',
    locatorKey: 'ibtHeading',
    smeFlags: [HOME_TILE_SME_FLAGS.IBT_NO_OBSERVED_SCENARIO],
    notes: 'Discovery only in Scout; no SC-BF-HOME-010 observed_scenario.',
  },
  {
    name: 'Report',
    assertType: 'urlIncludes',
    assertValue: 'order-tracking',
    scoutScenarioId: 'SC-BF-HOME-010-006',
    scoutDestination: 'Reports Master Page',
    notes: 'Teammate tile label "Report"; Scout scenario title "Home → Reports".',
  },
  {
    name: 'Customer Wishlist',
    assertType: 'visible',
    assertValue: 'Customer with Wishlist Items',
    locatorKey: 'customerWishlistText',
    scoutScenarioId: 'SC-BF-HOME-010-016',
    scoutDestination: '/ords/r/tjdcom/ea/customer-wish-list1',
  },
  {
    name: 'Solitaire Products',
    assertType: 'visible',
    assertValue: 'BRAND',
    locatorKey: 'brandInCurrentFilters',
    scoutScenarioId: 'SC-BF-HOME-010-017',
    scoutDestination: '/ords/r/tjdcom/ea/solitaire-products',
  },
  {
    name: 'New Collections',
    assertType: 'visible',
    assertValue: 'Make your own catalogue',
    locatorKey: 'makeOwnCatalogueButton',
    scoutScenarioId: 'SC-BF-HOME-010-018',
    scoutDestination: '/ords/r/tjdcom/ea/new-collections',
  },
  {
    name: 'High Value Studded',
    assertType: 'visible',
    assertValue: 'Make your own catalogue',
    locatorKey: 'makeOwnCatalogueButton',
    smeFlags: [HOME_TILE_SME_FLAGS.HIGH_VALUE_VS_LOOK_OF_WEEK],
    notes: 'Scout KB observed_scenario uses "Look of the Week" (SC-BF-HOME-010-019), not this tile label.',
  },
  {
    name: 'Silver Collections',
    assertType: 'urlIncludes',
    assertValue: 'silver-collections',
    scoutScenarioId: 'SC-BF-HOME-010-020',
    scoutDestination: '/ords/r/tjdcom/ea/silver-collections',
  },
  {
    name: 'Size Based Search',
    assertType: 'visible',
    assertValue: 'Item Search',
    locatorKey: 'itemSearchTextbox',
    scoutScenarioId: 'SC-BF-HOME-010-021',
    scoutDestination: '/ords/r/tjdcom/ea/size-based-search',
  },
  {
    name: 'Engagement -Min 7 Day Delivery',
    assertType: 'visible',
    assertValue: 'Make your own catalogue',
    locatorKey: 'makeOwnCatalogueButton',
    smeFlags: [HOME_TILE_SME_FLAGS.ENGAGEMENT_HOME_VS_RIVAAH],
    notes: 'Not in Scout home observed_scenarios; Engagement Rings is BF-RIVAAH-005-03 under Rivaah menu.',
  },
  {
    name: 'National/Regional Best Seller',
    assertType: 'urlIncludes',
    assertValue: 'national-best-seller',
    scoutScenarioId: 'SC-BF-HOME-010-022',
    scoutDestination: '/ords/r/tjdcom/ea/national-best-seller',
  },
  {
    name: 'Browse Store Stock',
    assertType: 'visible',
    assertValue: 'Welcome to TBO.. Please Scan',
    opensNewTab: true,
    locatorKey: 'browseStoreStockPopupText',
    smeFlags: [HOME_TILE_SME_FLAGS.BROWSE_STORE_STOCK],
    notes: 'Opens external/popup context; SME to confirm automation contract in Scout UAT.',
  },
  {
    name: 'KVI&FMC',
    assertType: 'visible',
    assertValue: 'Scan',
    locatorKey: 'scanButton',
    smeFlags: [HOME_TILE_SME_FLAGS.ADMIN_NESTED_TILE],
    notes: 'Also listed under BF-ADMINISTRATION-009; home card path not in observed_scenarios.',
  },
  {
    name: 'Shubh Gold Express',
    assertType: 'visible',
    assertValue: 'SHUBH GOLD EXPRESS',
    locatorKey: 'shubhGoldText',
    smeFlags: [HOME_TILE_SME_FLAGS.ADMIN_NESTED_TILE],
  },
  {
    name: 'Home Delivery',
    assertType: 'visible',
    assertValue: 'HomeHome Delivery Breadcrumb',
    locatorKey: 'homeDeliveryText',
    smeFlags: [HOME_TILE_SME_FLAGS.ADMIN_NESTED_TILE],
  },
  {
    name: 'Chatbot',
    assertType: 'visible',
    assertValue: 'GenAI Agents for APEX Inbuilt',
    locatorKey: 'chatbotText',
    smeFlags: [HOME_TILE_SME_FLAGS.ADMIN_NESTED_TILE],
  },
];

function mapAssertKind(
  assertType: TeammateTileSeed['assertType']
): HomeTileAssertKind {
  if (assertType === 'urlIncludes') return 'urlIncludes';
  if (assertType === 'containsText') return 'containsText';
  return 'visibleText';
}

export const HOME_TILE_MATRIX: HomeTileMatrixEntry[] = TEAMMATE_TILE_SEEDS.map((seed, index) => {
  const sme = SME_TILE_NAMES.has(seed.name) || (seed.smeFlags?.length ?? 0) > 0;
  const automation: HomeTileAutomationStatus = sme ? 'sme_required' : 'automated';
  const navigation: HomeTileNavigationContract | undefined = seed.assertValue
    ? {
        assertKind: mapAssertKind(seed.assertType),
        assertValue: seed.assertValue,
        opensNewTab: seed.opensNewTab,
        teammateLocatorKey: seed.locatorKey,
      }
    : undefined;

  return {
    order: index + 1,
    name: seed.name,
    automation,
    scoutScenarioId: seed.scoutScenarioId,
    scoutDestination: seed.scoutDestination,
    navigation,
    returnToHomeAfterNav: !seed.opensNewTab,
    smeFlags: seed.smeFlags,
    notes: seed.notes,
  };
});

export const HOME_TILE_EXPECTED_ORDER = HOME_TILE_MATRIX.map((t) => t.name);

export const HOME_TILES_AUTOMATED = HOME_TILE_MATRIX.filter((t) => t.automation === 'automated');

export const HOME_TILES_SME_REQUIRED = HOME_TILE_MATRIX.filter((t) => t.automation === 'sme_required');
