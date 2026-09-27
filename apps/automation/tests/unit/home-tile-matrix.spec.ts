import { test, expect } from '@playwright/test';
import {
  HOME_TILE_EXPECTED_COUNT,
  HOME_TILE_EXPECTED_ORDER,
  HOME_TILE_MATRIX,
  HOME_TILE_SME_FLAGS,
  HOME_TILES_AUTOMATED,
  HOME_TILES_SME_REQUIRED,
} from '../../src/data/home-tile-matrix';

test.describe('BF-HOME-010 home tile matrix @unit @BF-HOME-010', () => {
  test('matrix defines 28 teammate tiles in order', () => {
    expect(HOME_TILE_MATRIX.length).toBe(HOME_TILE_EXPECTED_COUNT);
    expect(HOME_TILE_EXPECTED_ORDER.length).toBe(HOME_TILE_EXPECTED_COUNT);
    expect(HOME_TILE_MATRIX.map((t) => t.name)).toEqual(HOME_TILE_EXPECTED_ORDER);
  });

  test('automated and SME-required partitions cover all tiles', () => {
    expect(HOME_TILES_AUTOMATED.length + HOME_TILES_SME_REQUIRED.length).toBe(HOME_TILE_EXPECTED_COUNT);
    const names = new Set<string>();
    for (const t of HOME_TILE_MATRIX) {
      expect(names.has(t.name), `duplicate tile name ${t.name}`).toBe(false);
      names.add(t.name);
    }
  });

  test('every automated tile has a navigation contract', () => {
    for (const tile of HOME_TILES_AUTOMATED) {
      expect(tile.navigation, tile.name).toBeTruthy();
      expect(tile.navigation!.assertValue.length).toBeGreaterThan(0);
    }
  });

  test('SME reconciliation tiles are flagged and not automated', () => {
    const smeNames = HOME_TILES_SME_REQUIRED.map((t) => t.name);
    expect(smeNames).toContain('High Value Studded');
    expect(smeNames).toContain('Engagement -Min 7 Day Delivery');
    expect(smeNames).toContain('Customer Order');
    expect(smeNames).toContain('ECOM Stock Visibility');
    expect(smeNames).toContain('Open IBT Action - Urgent');
    expect(smeNames).toContain('Browse Store Stock');
    expect(smeNames).toContain('KVI&FMC');
    expect(smeNames).toContain('Shubh Gold Express');
    expect(smeNames).toContain('Home Delivery');
    expect(smeNames).toContain('Chatbot');

    for (const tile of HOME_TILES_SME_REQUIRED) {
      expect(tile.smeFlags?.length, tile.name).toBeGreaterThan(0);
      expect(tile.automation).toBe('sme_required');
    }
  });

  test('Look of the Week mismatch documented on High Value Studded', () => {
    const hvs = HOME_TILE_MATRIX.find((t) => t.name === 'High Value Studded');
    expect(hvs?.smeFlags).toContain(HOME_TILE_SME_FLAGS.HIGH_VALUE_VS_LOOK_OF_WEEK);
    expect(hvs?.scoutScenarioId).toBeUndefined();
  });

  test('Engagement home tile is not conflated with Rivaah Engagement Rings scenario', () => {
    const engagement = HOME_TILE_MATRIX.find((t) => t.name === 'Engagement -Min 7 Day Delivery');
    expect(engagement?.smeFlags).toContain(HOME_TILE_SME_FLAGS.ENGAGEMENT_HOME_VS_RIVAAH);
  });
});
