'use client';

import { useGameState } from '@/hooks/useGameState';
import { useMiniKit } from '@coinbase/onchainkit/minikit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BROADCAST_RADIUS, MOVEMENT_MODE } from '@/constants/game';
import { useUIStore, useThreadStore, useBuildStore, useAgentStore, useUserStore, useUserAgentStore } from '@/stores';
import { useAccount } from 'wagmi';
import sdk from '@farcaster/miniapp-sdk';
import { StoredAgent } from '@/lib/redis';
import { useVillageLoader } from '@/hooks/useVillageLoader';
import { useVillageStore } from '@/stores/useVillageStore';
import { findNearestValidPosition } from '@/lib/village-utils';
import { useAgentLoader } from '@/hooks/useAgentLoader';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import DesktopLayout from '@/components/layouts/DesktopLayout';
import MobileLayout from '@/components/layouts/MobileLayout';

const DEFAULT_VILLAGE_SLUG = 'happy-village';

export default function Home() {
    // Village system - URL param + loader
    const searchParams = useSearchParams();
    const villageSlug = searchParams.get('village') ?? DEFAULT_VILLAGE_SLUG;
    const { isCurrentVillageLoaded } = useVillageLoader(villageSlug);
    const villageIsCollisionAt = useVillageStore((s) => s.isCollisionAt);

    // Desktop/mobile detection
    const { isDesktop } = useIsDesktop();

    // Global stores
    const { activeTab, setActiveTab } = useUIStore();
    const {
        threads,
        setCurrentThreadId,
        clearThreads,
    } = useThreadStore();
    const {
        customTiles,
        publishedTiles,
        isPublishing,
        publishStatus,
        collisionMap: globalCollisionMap,
        setCustomTiles,
        setPublishedTiles,
        setSelectedImage,
        setBuildMode,
        setIsPublishing,
        setPublishStatus,
        setCollisionMap,
        clearPublishStatusAfterDelay
    } = useBuildStore();
    const { worldPosition, userId, visibleAgents } = useGameState();
    const { spawnAgent } = useAgentStore();
    const { setFrameReady, isFrameReady } = useMiniKit();
    const [isSDKLoaded, setIsSDKLoaded] = useState(false);
    const { address } = useAccount();
    const { setAddress, setPermissions, setLastVerifiedAt, initSessionId, resetSessionId, getSessionId, hasMigratedThreads, setMigratedThreads, isPermissionExpired, verifyPermissions } = useUserStore();
    const { updateAgent: updateUserAgent } = useUserAgentStore();

    const [HUDOff, setHUDOff] = useState<boolean>(false);
    const hasInitializedAuth = useRef(false);
    const prevAddressRef = useRef<string | null>(null);

    // Initialize sessionId for guest users on mount
    useEffect(() => {
        initSessionId();
    }, [initSessionId]);

    // Guest session reset: Ctrl+Shift+X
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'X') {
                e.preventDefault();

                // Only allow when wallet is not connected (guest mode)
                if (address) return;

                clearThreads();
                setCurrentThreadId('0');
                resetSessionId();
                console.log('[AINSpace] Guest session reset: threads cleared, new session ID issued.');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [address, clearThreads, setCurrentThreadId, resetSessionId]);

    useEffect(() => {
        if (!isFrameReady) {
            setFrameReady();
        }

        if (process.env.NEXT_PUBLIC_NODE_ENV !== 'production') {
            setTimeout(() => {
                import('eruda').then((eruda) => eruda.default.init());
            }, 100);
        }
    }, []); // Run only once on mount

    useEffect(() => {
        const initUserAuth = async () => {
            if (!address) {
                setAddress(null);
                setPermissions(null);
                hasInitializedAuth.current = false;
                prevAddressRef.current = null;
                return;
            }

            // 재로그인 감지: address가 변경되면 무조건 재검증
            const isRelogin = address !== prevAddressRef.current;
            if (isRelogin) {
                console.log('Address changed, forcing re-verification:', { prev: prevAddressRef.current, new: address });
                hasInitializedAuth.current = false;
                prevAddressRef.current = address;
            }

            // 이미 초기화했으면 스킵 (단, 재로그인은 제외)
            if (hasInitializedAuth.current) return;
            hasInitializedAuth.current = true;

            setAddress(address);

            // Migrate threads from sessionId to wallet address on first login
            const sessionId = getSessionId();
            if (sessionId && !hasMigratedThreads(address)) {
                try {
                    const migrateResponse = await fetch('/api/threads/migrate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            sessionId,
                            walletAddress: address,
                        }),
                    });

                    if (migrateResponse.ok) {
                        const migrateData = await migrateResponse.json();
                        console.log(`Thread migration: ${migrateData.migratedCount} migrated, ${migrateData.skippedCount} skipped`);
                        setMigratedThreads(address);
                    } else {
                        console.error('Failed to migrate threads:', migrateResponse.statusText);
                    }
                } catch (error) {
                    console.error('Error migrating threads:', error);
                }
            }

            try {
                const getResponse = await fetch(`/api/auth/permissions/${address}`, {
                    method: 'GET',
                });

                if (getResponse.ok) {
                    const getData = await getResponse.json();

                    if (getData.success && getData.data) {
                        console.log('User already has permissions:', getData.data.permissions);
                        setPermissions(getData.data);

                        // Parse authCheckedAt from Redis and set as lastVerifiedAt
                        if (getData.data.authCheckedAt) {
                            const authCheckedTimestamp = new Date(getData.data.authCheckedAt).getTime();
                            setLastVerifiedAt(authCheckedTimestamp);
                        }

                        // 재로그인 시: 무조건 재검증 (expiry 체크 스킵)
                        if (isRelogin) {
                            console.log('Re-login detected, forcing verification regardless of expiry');
                            // Continue to verify below (don't return)
                        }
                        // 재접속 시: 6시간 expiry 체크
                        else if (isPermissionExpired()) {
                            console.log('Permission cache expired (6h+), re-verifying...');
                            // Continue to verify below (don't return)
                        } else {
                            console.log('Permission cache still valid (within 6h)');
                            return;
                        }
                    }
                }

                const verifyResponse = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        userId: address,
                    }),
                });

                if (!verifyResponse.ok) {
                    console.error('Failed to verify and grant auth:', verifyResponse.statusText);
                    return;
                }

                const verifyData = await verifyResponse.json();
                if (verifyData.success) {
                    console.log('Granted auths:', verifyData.data.grantedAuths);
                    console.log('User permissions:', verifyData.data.permissions);
                    setPermissions(verifyData.data.permissions);
                    setLastVerifiedAt(Date.now());
                } else {
                    console.error('Failed to verify and grant auth:', verifyData.error);
                }
            } catch (error) {
                console.error('Error during auth initialization:', error);
            }
        }

        initUserAuth();
    }, [address, setAddress, setPermissions, setLastVerifiedAt, getSessionId, hasMigratedThreads, setMigratedThreads])

    // Periodic permission refresh
    useEffect(() => {
        if (!address) return;

        const checkInterval = 5 * 60 * 1000; // Check every 5 minutes

        const intervalId = setInterval(async () => {
            if (isPermissionExpired()) {
                console.log('Permission expired during session, refreshing...');
                const result = await verifyPermissions(address);
                if (result.success) {
                    console.log('Permission refreshed successfully');
                } else {
                    console.error('Failed to refresh permission');
                }
            }
        }, checkInterval);

        return () => clearInterval(intervalId);
    }, [address, isPermissionExpired, verifyPermissions]);

    // useEffect(() => {
    //     const loadCustomTiles = async () => {
    //         if (!userId) return;

    //         try {
    //             const response = await fetch(`/api/custom-tiles?userId=${userId}`);
    //             if (response.ok) {
    //                 const data = await response.json();
    //                 if (!data.isDefault && data.tiles) {
    //                     setPublishedTiles(data.tiles);
    //                     const totalTiles =
    //                         Object.keys(data.tiles.layer0 || {}).length +
    //                         Object.keys(data.tiles.layer1 || {}).length +
    //                         Object.keys(data.tiles.layer2 || {}).length;
    //                     console.log(`Loaded ${totalTiles} published tiles from server`);

    //                     // Also update collision map with existing layer1 items
    //                     const layer1Items = data.tiles.layer1 || {};

    //                     // Get current collision map from store to avoid dependency
    //                     const currentCollisionMap = useBuildStore.getState().collisionMap;
    //                     const existingCollisionTiles: { [key: string]: boolean } = { ...currentCollisionMap };

    //                     Object.keys(layer1Items).forEach((key) => {
    //                         existingCollisionTiles[key] = true;
    //                     });

    //                     setCollisionMap(existingCollisionTiles);
    //                     console.log(
    //                         `Updated collision map with ${Object.keys(layer1Items).length} existing blocked tiles`
    //                     );
    //                 }
    //             }
    //         } catch (error) {
    //             console.error('Failed to load custom tiles:', error);
    //         }
    //     };

    //     // loadCustomTiles();
    // }, [userId, setPublishedTiles, setCollisionMap]);

    const handleAgentClick = (agentId: string, agentName: string) => {
        console.log(`Agent clicked: ${agentName} (${agentId})`);

        // Find the most recent thread that includes this agent
        const agentThread = threads.find((thread) => thread.agentNames.includes(agentName));

        if (agentThread) {
            // If there's a thread with this agent, open it
            setCurrentThreadId(agentThread.id);
        }

        // Open the BottomSheet to show the ThreadTab
        // openBottomSheet();
    };

    // Handler for placing agent at specific position from MapTab
    const handlePlaceAgentAtPosition = useCallback(async (
        agent: StoredAgent,
        x: number,
        y: number,
        mapName: string,
        movementMode: MOVEMENT_MODE
    ) => {
        if (!address) {
            throw new Error('Address is not connected');
        }

        console.log('Placing agent at position:', x, y, mapName);

        const agentId = `a2a-${Date.now()}`;
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        // Register agent with backend Redis
        const registerResponse = await fetch('/api/agents', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: agent.url,
                creator: address,
                state: {
                    x: x,
                    y: y,
                    behavior: 'random',
                    color: randomColor,
                    moveInterval: 600 + Math.random() * 400,
                    // Include spawn data and movement mode
                    spawnX: x,
                    spawnY: y,
                    mapName: mapName,
                    movementMode: movementMode
                },
                isPlaced: true,
                mapName: mapName,
            }),
        });

        if (!registerResponse.ok && registerResponse.status !== 409) {
            const errorData = await registerResponse.json();
            throw new Error(errorData.error || 'Failed to place agent');
        }

        console.log(`✓ Agent registered with backend Redis at (${x}, ${y}): spawn=(${x}, ${y}), map=${mapName}, mode=${movementMode}`);

        updateUserAgent(agent.url, {
            isPlaced: true,
        });
        // Add to spawned A2A agents for UI tracking
        spawnAgent({
            id: agentId,
            name: agent.card.name,
            x: x,
            y: y,
            color: agent.state.color || randomColor,
            agentUrl: agent.url,
            behavior: 'random',
            lastMoved: Date.now(),
            moveInterval: agent.state.moveInterval || 600 + Math.random() * 400,
            skills: agent.card.skills || [],
            spriteUrl: agent.spriteUrl,
            spriteHeight: agent.spriteHeight || 50,
            // Include spawn data and movement mode
            spawnX: x,
            spawnY: y,
            mapName: mapName,
            movementMode: movementMode
        });
    }, [address, spawnAgent, updateUserAgent]);

    const handlePublishTiles = async () => {
        const totalCustomTiles =
            Object.keys(customTiles.layer0 || {}).length +
            Object.keys(customTiles.layer1 || {}).length +
            Object.keys(customTiles.layer2 || {}).length;

        if (!userId || totalCustomTiles === 0) {
            setPublishStatus({
                type: 'error',
                message: 'No custom tiles to publish'
            });
            return;
        }

        setIsPublishing(true);
        setPublishStatus(null);

        try {
            const response = await fetch('/api/custom-tiles', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: userId,
                    customTiles: customTiles
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // Move custom tiles to published tiles and reset build state
            setPublishedTiles((prev) => ({
                layer0: { ...(prev.layer0 || {}), ...(customTiles.layer0 || {}) },
                layer1: { ...(prev.layer1 || {}), ...(customTiles.layer1 || {}) },
                layer2: { ...(prev.layer2 || {}), ...(customTiles.layer2 || {}) }
            }));

            // Update collision map based on newly placed layer1 items
            // For each placed item in layer1, we need to analyze its pixels to determine blocked tiles
            const layer1Items = customTiles.layer1 || {};

            // Get current collision map from store
            const currentCollisionMap = useBuildStore.getState().collisionMap;
            const newCollisionTiles: { [key: string]: boolean } = { ...currentCollisionMap };

            // Mark all placed item positions as blocked
            Object.keys(layer1Items).forEach((key) => {
                newCollisionTiles[key] = true;
            });

            setCollisionMap(newCollisionTiles);
            console.log(
                `Updated collision map with ${Object.keys(layer1Items).length} new blocked tiles from published items`
            );

            setPublishStatus({
                type: 'success',
                message: `Published ${data.tileCount} custom tiles successfully!`
            });

            setCustomTiles({ layer0: {}, layer1: {}, layer2: {} }); // Clear draft tiles since they're now published
            setSelectedImage(null);
            setBuildMode('select');

            // Clear status after 5 seconds
            clearPublishStatusAfterDelay(5000);
        } catch (error) {
            console.error('Failed to publish custom tiles:', error);
            setPublishStatus({
                type: 'error',
                message: 'Failed to publish tiles. Please try again.'
            });

            // Clear status after 5 seconds
            clearPublishStatusAfterDelay(5000);
        } finally {
            setIsPublishing(false);
        }
    };

    // Position validation for agent placement
    const isPositionValid = useCallback((x: number, y: number): boolean => {
      // Check if position is in a village and not blocked by TMJ collision
      if (villageIsCollisionAt(x, y)) {
          return false;
      }

      // Check if position is blocked by build items
      if (useBuildStore.getState().isBlocked(x, y)) {
          return false;
      }

      // Check if position is occupied by player
      if (x === worldPosition.x && y === worldPosition.y) {
          return false;
      }

      // Check if position is occupied by another agent
      const currentA2AAgents = useAgentStore.getState().agents;
      const allAgents = [...visibleAgents, ...currentA2AAgents];
      const isOccupied = allAgents.some((agent) => agent.x === x && agent.y === y);
      return !isOccupied;
  }, [villageIsCollisionAt, worldPosition, visibleAgents]);

  // Find a non-blocked spawn position in one of the deployment zones
  const findAvailableSpawnPositionByRadius = useCallback((selectedCenter: { x: number; y: number }): { x: number; y: number } | null => {
    return findNearestValidPosition(
      selectedCenter.x,
      selectedCenter.y,
      (x, y) => !isPositionValid(x, y),
      BROADCAST_RADIUS,
    );
  }, [isPositionValid]);

    // 에이전트 로딩: loadedVillages 기반으로 마을별 안전 스폰
    useAgentLoader({
        isCurrentVillageLoaded,
        isPositionValid,
        findAvailableSpawnPosition: findAvailableSpawnPositionByRadius,
    });

    useEffect(() => {
        const load = async () => {
            sdk.actions.ready({ disableNativeGestures: true });
        };
        if (sdk && !isSDKLoaded) {
            setIsSDKLoaded(true);
            load();
        }
    }, [isSDKLoaded]);

    // Tab normalization: desktop uses 'chat' instead of 'map', mobile uses 'map' instead of 'chat'
    useEffect(() => {
        if (isDesktop && activeTab === 'map') {
            setActiveTab('chat');
        } else if (!isDesktop && activeTab === 'chat') {
            setActiveTab('map');
        }
    }, [isDesktop, activeTab, setActiveTab]);

    const handleHUDOffChange = (hudOff: boolean) => {
        setHUDOff(hudOff);
    };

    const layoutProps = {
        activeTab,
        setActiveTab,
        HUDOff,
        onHUDOffChange: handleHUDOffChange,
        publishedTiles,
        customTiles,
        collisionMap: globalCollisionMap,
        onAgentClick: handleAgentClick,
        isPositionValid,
        onPlaceAgentAtPosition: handlePlaceAgentAtPosition,
        setCustomTiles,
        setPublishedTiles,
        isPublishing,
        publishStatus,
        userId,
        onPublishTiles: handlePublishTiles,
    };

    if (isDesktop) {
        return <DesktopLayout {...layoutProps} />;
    }

    return <MobileLayout {...layoutProps} />;
}
