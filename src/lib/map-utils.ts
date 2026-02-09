/**
 * @deprecated This file contains legacy map utilities for the old single-map system.
 * Use village-utils.ts and useVillageStore for the new dynamic village system.
 *
 * Migration guide:
 * - getMapNameFromCoordinates(x, y) → useVillageStore.getVillageSlugAtGrid(gridX, gridY)
 * - MAP_ZONES boundaries → gridToWorldRange(gridX, gridY, gridWidth, gridHeight)
 * - Coordinate conversion → use worldToGrid(), worldToLocal(), etc. from village-utils.ts
 */

import { MAP_NAMES, MAP_ZONES } from '@/constants/game';

/**
 * @deprecated Use useVillageStore.getVillageSlugAtGrid() instead.
 * Get the map name from world coordinates
 * @param x World X coordinate
 * @param y World Y coordinate
 * @returns MAP_NAMES if the coordinate is within a map zone, null otherwise
 */
export function getMapNameFromCoordinates(x: number, y: number): MAP_NAMES | null {
  for (const [mapName, zone] of Object.entries(MAP_ZONES)) {
    if (x >= zone.startX && x <= zone.endX && y >= zone.startY && y <= zone.endY) {
      return mapName as MAP_NAMES;
    }
  }
  return null;
}
