import { VILLAGE_SIZE } from '@/constants/game';

/**
 * 글로벌 월드 좌표에서 마을 격자 좌표를 계산한다.
 *
 * 마을 grid(gx, gy)는 world range [gx*VILLAGE_SIZE - VILLAGE_SIZE/2, gx*VILLAGE_SIZE + VILLAGE_SIZE/2 - 1] 을 차지한다.
 * 예: grid(0,0) → world (-10,-10) ~ (9,9), center (0,0)
 *     grid(1,0) → world (10,-10) ~ (29,9), center (20,0)
 */
export function worldToGrid(worldX: number, worldY: number): { gridX: number; gridY: number } {
  const half = VILLAGE_SIZE / 2;
  return {
    gridX: Math.floor((worldX + half) / VILLAGE_SIZE),
    gridY: Math.floor((worldY + half) / VILLAGE_SIZE),
  };
}

/**
 * 마을 격자 좌표에서 해당 마을의 글로벌 월드 좌표 범위를 반환한다.
 */
export function gridToWorldRange(gridX: number, gridY: number): {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  centerX: number;
  centerY: number;
} {
  const half = VILLAGE_SIZE / 2;
  return {
    startX: gridX * VILLAGE_SIZE - half,
    startY: gridY * VILLAGE_SIZE - half,
    endX: gridX * VILLAGE_SIZE + half - 1,
    endY: gridY * VILLAGE_SIZE + half - 1,
    centerX: gridX * VILLAGE_SIZE,
    centerY: gridY * VILLAGE_SIZE,
  };
}

/**
 * 글로벌 월드 좌표를 해당 마을 내 로컬 좌표(TMJ 인덱스용)로 변환한다.
 * localX, localY는 0 ~ VILLAGE_SIZE-1 범위.
 */
export function worldToLocal(worldX: number, worldY: number): {
  localX: number;
  localY: number;
  gridX: number;
  gridY: number;
} {
  const { gridX, gridY } = worldToGrid(worldX, worldY);
  const half = VILLAGE_SIZE / 2;
  return {
    localX: worldX - (gridX * VILLAGE_SIZE - half),
    localY: worldY - (gridY * VILLAGE_SIZE - half),
    gridX,
    gridY,
  };
}

/**
 * 마을 격자 좌표 + 로컬 좌표 → 글로벌 월드 좌표
 */
export function localToWorld(
  gridX: number,
  gridY: number,
  localX: number,
  localY: number,
): { worldX: number; worldY: number } {
  const half = VILLAGE_SIZE / 2;
  return {
    worldX: gridX * VILLAGE_SIZE - half + localX,
    worldY: gridY * VILLAGE_SIZE - half + localY,
  };
}

/**
 * 격자 좌표를 Redis 키 형식 문자열로 변환한다.
 */
export function gridKey(gridX: number, gridY: number): string {
  return `${gridX},${gridY}`;
}

/**
 * 주어진 격자 좌표의 인접 9칸 (자기 자신 포함) 격자 좌표를 반환한다.
 * 순서: 자기 자신 → 상하좌우 → 대각
 */
export function getNearbyCells(gridX: number, gridY: number): Array<{ gridX: number; gridY: number }> {
  return [
    // 자기 자신
    { gridX, gridY },
    // 상하좌우 (NSEW)
    { gridX, gridY: gridY - 1 },
    { gridX, gridY: gridY + 1 },
    { gridX: gridX - 1, gridY },
    { gridX: gridX + 1, gridY },
    // 대각
    { gridX: gridX - 1, gridY: gridY - 1 },
    { gridX: gridX + 1, gridY: gridY - 1 },
    { gridX: gridX - 1, gridY: gridY + 1 },
    { gridX: gridX + 1, gridY: gridY + 1 },
  ];
}
