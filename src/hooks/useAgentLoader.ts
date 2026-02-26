'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAgentStore } from '@/stores';
import { useVillageStore } from '@/stores/useVillageStore';
import { StoredAgent } from '@/lib/redis';
import { worldToGrid } from '@/lib/village-utils';
import { DEFAULT_MOVEMENT_MODE } from '@/constants/game';

interface UseAgentLoaderOpts {
  isCurrentVillageLoaded: boolean;
  isPositionValid: (x: number, y: number) => boolean;
  findAvailableSpawnPosition: (center: { x: number; y: number }) => { x: number; y: number } | null;
}

/**
 * 에이전트 로딩 전용 hook.
 *
 * loadedVillages 변경을 감지하고, 해당 마을의 에이전트만 스폰한다.
 * 아직 로드되지 않은 마을의 에이전트는 대기했다가 해당 마을 로드 후 스폰된다.
 */
export function useAgentLoader({
  isCurrentVillageLoaded,
  isPositionValid,
  findAvailableSpawnPosition,
}: UseAgentLoaderOpts): void {
  // 전체 에이전트 목록 (API에서 1회 fetch)
  const allAgentsRef = useRef<StoredAgent[]>([]);
  // 이미 스폰한 에이전트 URL 추적 (중복 방지)
  const spawnedUrlsRef = useRef<Set<string>>(new Set());
  // API fetch 완료 여부
  const hasFetchedRef = useRef(false);

  const loadedVillages = useVillageStore((s) => s.loadedVillages);
  const { spawnAgent } = useAgentStore();

  const spawnReadyAgents = useCallback(() => {
    const currentLoadedVillages = useVillageStore.getState().loadedVillages;
    const getVillageSlugAtGrid = useVillageStore.getState().getVillageSlugAtGrid;

    for (const agentData of allAgentsRef.current) {
      // 이미 스폰했으면 skip
      if (spawnedUrlsRef.current.has(agentData.url)) continue;

      const { url, card, state, spriteUrl, spriteHeight } = agentData;

      // 에이전트의 마을 결정
      let mapName = state.mapName;
      if (!mapName) {
        const { gridX, gridY } = worldToGrid(state.x!, state.y!);
        mapName = getVillageSlugAtGrid(gridX, gridY);
        // gridIndex에도 없으면 아직 해당 마을 정보가 로드되지 않은 것 → 대기
        if (!mapName) continue;
      }

      // 해당 마을이 아직 로드되지 않았으면 skip (다음 loadedVillages 변경 시 재시도)
      if (!currentLoadedVillages.has(mapName)) continue;

      // 기존 스토어에 이미 있으면 skip
      const existingAgents = useAgentStore.getState().agents;
      if (existingAgents.find((agent) => agent.agentUrl === url)) {
        spawnedUrlsRef.current.add(url);
        continue;
      }

      // 위치 검증 + 스폰
      let spawnX = state.x!;
      let spawnY = state.y!;

      if (!isPositionValid(spawnX, spawnY)) {
        const validPosition = findAvailableSpawnPosition({ x: spawnX, y: spawnY });
        if (!validPosition) {
          // 스폰 불가 — 다음 기회에 재시도
          continue;
        }
        spawnX = validPosition.x;
        spawnY = validPosition.y;
      }

      // Migration logic for spawn position and movement mode
      const migratedState = {
        ...state,
        spawnX: state.spawnX ?? spawnX,
        spawnY: state.spawnY ?? spawnY,
        mapName: mapName,
        movementMode: state.movementMode ?? DEFAULT_MOVEMENT_MODE,
      };

      const agentId = `a2a-deployed-${Date.now()}-${Math.random()}`;

      console.log(`[useAgentLoader] Spawning agent ${card.name}:`, {
        spawn: `(${migratedState.spawnX}, ${migratedState.spawnY})`,
        actual: `(${spawnX}, ${spawnY})`,
        map: migratedState.mapName,
        mode: migratedState.movementMode,
      });

      spawnAgent({
        id: agentId,
        name: card.name || 'Deployed Agent',
        color: state.color,
        behavior: 'random',
        x: spawnX,
        y: spawnY,
        agentUrl: url,
        lastMoved: Date.now(),
        moveInterval: state.moveInterval || 800,
        skills: card.skills,
        spriteUrl: spriteUrl,
        spriteHeight: spriteHeight || 40,
        spawnX: migratedState.spawnX,
        spawnY: migratedState.spawnY,
        mapName: migratedState.mapName,
        movementMode: migratedState.movementMode,
      });

      spawnedUrlsRef.current.add(url);
    }
  }, [isPositionValid, findAvailableSpawnPosition, spawnAgent]);

  // 현재 마을 로드 완료 시 1회 fetch + 스폰
  useEffect(() => {
    if (!isCurrentVillageLoaded || hasFetchedRef.current) return;

    const fetchAndSpawn = async () => {
      try {
        const response = await fetch('/api/agents');
        if (!response.ok) {
          console.error('[useAgentLoader] Failed to load deployed agents');
          return;
        }

        const data = await response.json();
        if (!data.success || !data.agents) {
          console.error('[useAgentLoader] Invalid agents data from API');
          return;
        }

        const deployedAgents = data.agents.filter((a: StoredAgent) => a.isPlaced);
        console.log(`[useAgentLoader] Fetched ${deployedAgents.length} deployed agents`);

        allAgentsRef.current = deployedAgents;
        hasFetchedRef.current = true;

        spawnReadyAgents();
      } catch (error) {
        console.error('[useAgentLoader] Error fetching agents:', error);
      }
    };

    fetchAndSpawn();
  }, [isCurrentVillageLoaded, spawnReadyAgents]);

  // loadedVillages 변경 시 대기 중인 에이전트 스폰 시도
  useEffect(() => {
    if (!hasFetchedRef.current) return;
    spawnReadyAgents();
  }, [loadedVillages, spawnReadyAgents]);
}
