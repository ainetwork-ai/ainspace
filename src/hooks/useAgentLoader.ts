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
  // 전체 에이전트 목록 (마을별 fetch로 점진적 누적)
  const allAgentsRef = useRef<StoredAgent[]>([]);
  // 이미 스폰한 에이전트 URL 추적 (중복 방지)
  const spawnedUrlsRef = useRef<Set<string>>(new Set());
  // 이미 fetch한 마을 slug 추적 (중복 fetch 방지)
  const fetchedVillagesRef = useRef<Set<string>>(new Set());
  // fetch 실패 횟수 추적 (무한 재시도 방지)
  const fetchFailCountRef = useRef<Map<string, number>>(new Map());
  const MAX_FETCH_RETRIES = 2;
  // 초기 fetch 완료 여부
  const hasFetchedRef = useRef(false);

  const loadedVillages = useVillageStore((s) => s.loadedVillages);
  const { spawnAgent } = useAgentStore();

  const spawnReadyAgentsRef = useRef<() => void>(() => {});

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

  // ref를 항상 최신 콜백으로 유지
  spawnReadyAgentsRef.current = spawnReadyAgents;

  /** 마을 목록에 해당하는 에이전트를 fetch하고 allAgentsRef에 누적 */
  const fetchAgentsForVillages = useCallback(async (villageSlugs: string[]) => {
    const isDev = process.env.NEXT_PUBLIC_ENABLE_PERF_MARKS === 'true';
    const newSlugs = villageSlugs.filter(s =>
      !fetchedVillagesRef.current.has(s) &&
      (fetchFailCountRef.current.get(s) ?? 0) < MAX_FETCH_RETRIES
    );
    if (newSlugs.length === 0) return;

    // fetch 전에 마킹하여 중복 방지
    newSlugs.forEach(s => fetchedVillagesRef.current.add(s));

    try {
      if (isDev) performance.mark('agents-fetch-start');
      const response = await fetch(`/api/agents?villages=${newSlugs.join(',')}`);
      if (!response.ok) {
        console.error('[useAgentLoader] Failed to load deployed agents');
        return;
      }

      const data = await response.json();
      if (isDev) {
        performance.mark('agents-fetch-end');
        performance.measure(`⏱ agents fetch (${newSlugs.join(',')})`, 'agents-fetch-start', 'agents-fetch-end');
      }
      if (!data.success || !data.agents) {
        console.error('[useAgentLoader] Invalid agents data from API');
        return;
      }

      const deployedAgents = data.agents.filter((a: StoredAgent) => a.isPlaced);

      // 기존 목록에 점진적 누적 (중복 URL 방지)
      const existingUrls = new Set(allAgentsRef.current.map(a => a.url));
      const newAgents = deployedAgents.filter((a: StoredAgent) => !existingUrls.has(a.url));
      allAgentsRef.current = [...allAgentsRef.current, ...newAgents];

      if (isDev) performance.mark('agents-spawn-start');
      spawnReadyAgentsRef.current();
      if (isDev) {
        performance.mark('agents-spawn-end');
        performance.measure(`⏱ agents spawn (${newAgents.length} new)`, 'agents-spawn-start', 'agents-spawn-end');
      }
    } catch (error) {
      // fetch 실패 시 마킹 해제 + 실패 횟수 누적
      newSlugs.forEach(s => {
        fetchedVillagesRef.current.delete(s);
        fetchFailCountRef.current.set(s, (fetchFailCountRef.current.get(s) ?? 0) + 1);
      });
      console.error('[useAgentLoader] Error fetching agents:', error);
    }
  }, []);

  // 현재 마을 로드 완료 시 초기 fetch
  useEffect(() => {
    if (!isCurrentVillageLoaded || hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const currentSlug = useVillageStore.getState().currentVillageSlug;
    if (currentSlug) {
      fetchAgentsForVillages([currentSlug]);
    }
  }, [isCurrentVillageLoaded, fetchAgentsForVillages]);

  // loadedVillages 변경 시: 새로 로드된 마을의 에이전트 fetch + 대기 중 스폰
  useEffect(() => {
    if (!hasFetchedRef.current) return;

    // 새로 로드된 마을 중 아직 fetch하지 않은 것만 추출
    const newVillages: string[] = [];
    loadedVillages.forEach((_, slug) => {
      if (!fetchedVillagesRef.current.has(slug)) {
        newVillages.push(slug);
      }
    });

    if (newVillages.length > 0) {
      fetchAgentsForVillages(newVillages);
    } else {
      // 새 fetch 없어도 대기 중인 에이전트 스폰 시도
      spawnReadyAgents();
    }
  }, [loadedVillages, spawnReadyAgents, fetchAgentsForVillages]);
}
