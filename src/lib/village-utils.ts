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
 * NxM 마을의 경우 gridWidth, gridHeight를 전달한다. (기본 1x1)
 */
export function gridToWorldRange(gridX: number, gridY: number, gridWidth = 1, gridHeight = 1): {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  centerX: number;
  centerY: number;
} {
  const half = VILLAGE_SIZE / 2;
  const startX = gridX * VILLAGE_SIZE - half;
  const startY = gridY * VILLAGE_SIZE - half;
  const endX = startX + gridWidth * VILLAGE_SIZE - 1;
  const endY = startY + gridHeight * VILLAGE_SIZE - 1;
  return {
    startX,
    startY,
    endX,
    endY,
    centerX: Math.floor((startX + endX) / 2),
    centerY: Math.floor((startY + endY) / 2),
  };
}

/**
 * 글로벌 월드 좌표를 해당 마을 내 로컬 좌표(TMJ 인덱스용)로 변환한다.
 * 1x1 마을 전용. NxM 마을은 worldToLocalInVillage를 사용한다.
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
 * 글로벌 월드 좌표를 마을 origin 기준 로컬 좌표로 변환한다.
 * NxM 마을에서는 origin grid(좌상단)를 기준으로 계산해야 한다.
 *
 * 예: 2x2 마을 origin(0,0) → world(-10,-10)~(29,29), TMJ 40x40
 *     world(15, 5) → local(25, 15)
 */
export function worldToLocalInVillage(
  worldX: number,
  worldY: number,
  villageGridX: number,
  villageGridY: number,
): { localX: number; localY: number } {
  const half = VILLAGE_SIZE / 2;
  return {
    localX: worldX - (villageGridX * VILLAGE_SIZE - half),
    localY: worldY - (villageGridY * VILLAGE_SIZE - half),
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
 * 중심 좌표에서 가장 가까운 유효 위치를 찾는다.
 * 중심이 유효하면 그대로 반환하고, 아니면 반경을 확장하며 perimeter를 탐색한다.
 *
 * @param centerX - 중심 world X 좌표
 * @param centerY - 중심 world Y 좌표
 * @param isBlocked - 해당 좌표가 막혀있는지 판별하는 콜백
 * @param maxRadius - 최대 탐색 반경 (기본 10)
 * @returns 유효한 위치 또는 null
 */
export function findNearestValidPosition(
  centerX: number,
  centerY: number,
  isBlocked: (x: number, y: number) => boolean,
  maxRadius = 10,
): { x: number; y: number } | null {
  // 중심이 유효하면 그대로 반환
  if (!isBlocked(centerX, centerY)) {
    return { x: centerX, y: centerY };
  }

  for (let radius = 1; radius <= maxRadius; radius++) {
    const positionsAtRadius: { x: number; y: number }[] = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
          positionsAtRadius.push({
            x: centerX + dx,
            y: centerY + dy,
          });
        }
      }
    }

    // 셔플하여 랜덤성 부여
    positionsAtRadius.sort(() => Math.random() - 0.5);

    for (const pos of positionsAtRadius) {
      if (!isBlocked(pos.x, pos.y)) {
        return pos;
      }
    }
  }

  return null;
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
