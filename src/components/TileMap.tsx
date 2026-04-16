'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { TILE_SIZE, DIRECTION, BROADCAST_RADIUS, VILLAGE_SIZE } from '@/constants/game';
import { worldToGrid } from '@/lib/village-utils';
import { useBuildStore, useChatStore, useGameStateStore, useUserStore } from '@/stores';
import type { TileLayers } from '@/stores';
import { AgentState } from '@/lib/agent';
import { calculateDistance } from '@/lib/utils';
import { useTiledMap } from '@/hooks/useTiledMap';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { useVillageStore } from '@/stores/useVillageStore';
import { Loader2 } from 'lucide-react';
import CSSSprite from './CSSSprite';
import type { OnlinePlayer } from '@/hooks/useVillagePresence';

interface TileMapProps {
    mapData: number[][];
    tileSize: number;
    playerPosition: { x: number; y: number };
    agents?: AgentState[];
    customTiles?: TileLayers | { [key: string]: string };
    layerVisibility?: { [key: number]: boolean };
    buildMode?: 'view' | 'paint';
    onTileClick?: (x: number, y: number) => void;
    onDeleteTile?: (layer: 0 | 1 | 2, key: string) => void;
    playerDirection?: DIRECTION;
    playerIsMoving?: boolean;
    collisionMap?: { [key: string]: boolean };
    selectedItemDimensions?: { width: number; height: number } | null;
    enableZoom?: boolean;
    zoomControls?: 'wheel' | 'buttons' | 'both';
    fixedZoom?: number;
    hideCoordinates?: boolean;
    onAgentClick?: (agentId: string, agentName: string) => void;
    isPositionValid?: (x: number, y: number) => boolean;
    selectedPosition?: { x: number; y: number } | null;
    onlinePlayers?: OnlinePlayer[];
}

function TileMap({
    tileSize: baseTileSize,
    agents = [],
    customTiles = {},
    buildMode = 'view',
    onTileClick,
    playerDirection = DIRECTION.DOWN,
    playerIsMoving = false,
    collisionMap = {},
    selectedItemDimensions = null,
    enableZoom = false,
    zoomControls = 'both',
    fixedZoom,
    hideCoordinates = false,
    onAgentClick,
    isPositionValid,
    selectedPosition = null,
    onlinePlayers,
}: TileMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const [isPainting, setIsPainting] = useState(false);
    const [lastPaintedTile, setLastPaintedTile] = useState<{ x: number; y: number } | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

    const router = useRouter();
    const { worldPosition } = useGameStateStore();
    const isCurrentVillageLoaded = useVillageStore((s) => s.isCurrentVillageLoaded);
    const loadedVillagesMap = useVillageStore((s) => s.loadedVillages);
    const loadedVillagesArr = useMemo(() => Array.from(loadedVillagesMap.values()).map((v) => v.metadata), [loadedVillagesMap]);
    
    const [zoomLevel, setZoomLevel] = useState(fixedZoom !== undefined ? fixedZoom : 1.0);
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2.0;
    const ZOOM_STEP = 0.25;

    const tileSize = baseTileSize * (fixedZoom !== undefined ? fixedZoom : zoomLevel);
    
    const { canvasRef, cameraTilePosition } = useTiledMap(
        canvasSize,
        tileSize
    );
  
    const [hoveredWorldCoords, setHoveredWorldCoords] = useState<{ worldX: number; worldY: number } | null>(null);
    const [isTouchDevice, setIsTouchDevice] = useState(false);

    const { showCollisionMap, toggleCollisionMap } = useBuildStore();
    const { isAgentLoading } = useChatStore();



    useEffect(() => {
        const updateCanvasSize = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();

                if (rect.width > 0 && rect.height > 0) {
                    setCanvasSize({
                        width: rect.width,
                        height: rect.height
                    });
                }
            }
        };

        const timeoutId = setTimeout(updateCanvasSize, 100);
        updateCanvasSize();
        window.addEventListener('resize', updateCanvasSize);
        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener('resize', updateCanvasSize);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.key === 'j') {
                event.preventDefault();
                toggleCollisionMap();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [toggleCollisionMap]);

    const handleZoomIn = () => {
        setZoomLevel((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
    };

    const handleZoomOut = () => {
        setZoomLevel((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
    };

    const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
        if (!enableZoom || (zoomControls !== 'wheel' && zoomControls !== 'both')) return;

        event.preventDefault();

        if (event.deltaY < 0) {
            handleZoomIn();
        } else if (event.deltaY > 0) {
            handleZoomOut();
        }
    };

    // Shared coordinate calculation for both mouse and touch events
    const getWorldCoordinatesFromClientPos = (clientX: number, clientY: number) => {
        const container = containerRef.current;
        if (!container) return null;

        const { isCurrentVillageLoaded } = useVillageStore.getState();
        if (!isCurrentVillageLoaded) return null;

        const rect = container.getBoundingClientRect();
        const viewX = (clientX - rect.left) * (canvasSize.width / rect.width);
        const viewY = (clientY - rect.top) * (canvasSize.height / rect.height);

        const screenTileX = Math.floor(viewX / tileSize);
        const screenTileY = Math.floor(viewY / tileSize);

        // Calculate visible tiles
        const tilesX = Math.ceil(canvasSize.width / tileSize);
        const tilesY = Math.ceil(canvasSize.height / tileSize);

        if (screenTileX >= 0 && screenTileX < tilesX && screenTileY >= 0 && screenTileY < tilesY) {
            const worldX = cameraTilePosition.x + screenTileX;
            const worldY = cameraTilePosition.y + screenTileY;

            return { worldX, worldY };
        }

        return null;
    };

    const getWorldCoordinatesFromEvent = (event: React.MouseEvent<HTMLElement>) => {
        return getWorldCoordinatesFromClientPos(event.clientX, event.clientY);
    };

    const paintTileAt = (worldX: number, worldY: number) => {
        if (!onTileClick) return;

        if (lastPaintedTile && lastPaintedTile.x === worldX && lastPaintedTile.y === worldY) {
            return;
        }

        setLastPaintedTile({ x: worldX, y: worldY });
        onTileClick(worldX, worldY);
    };

    const handleMouseDown = (event: React.MouseEvent<HTMLElement>) => {
        if (buildMode === 'paint') {
            const coords = getWorldCoordinatesFromEvent(event);
            if (coords) {
                setIsPainting(true);
                paintTileAt(coords.worldX, coords.worldY);
            }
        }
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLElement>) => {
        const coords = getWorldCoordinatesFromEvent(event);

        if (buildMode === 'paint') {
            if (coords) {
                setHoveredWorldCoords({ worldX: coords.worldX, worldY: coords.worldY });
            } else {
                setHoveredWorldCoords(null);
            }
        } else {
            setHoveredWorldCoords(null);
        }

        if (buildMode !== 'paint' || !isPainting) return;

        if (coords) {
            paintTileAt(coords.worldX, coords.worldY);
        }
    };

    const handleMouseUp = () => {
        setIsPainting(false);
        setLastPaintedTile(null);
    };

    const handleMouseLeave = () => {
        setIsPainting(false);
        setLastPaintedTile(null);
        setHoveredWorldCoords(null);
    };

    const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
        if (event.touches.length === 0) return;

        event.preventDefault();
        setIsTouchDevice(true);

        const touch = event.touches[0];

        if (buildMode === 'paint') {
            const coords = getWorldCoordinatesFromClientPos(touch.clientX, touch.clientY);
            if (coords) {
                setIsPainting(true);
                paintTileAt(coords.worldX, coords.worldY);
            }
        }
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLElement>) => {
        if (buildMode !== 'paint' || !isPainting || event.touches.length === 0) return;

        const touch = event.touches[0];
        const coords = getWorldCoordinatesFromClientPos(touch.clientX, touch.clientY);
        if (coords) {
            paintTileAt(coords.worldX, coords.worldY);
        }
    };

    const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
        event.preventDefault();
        setIsPainting(false);
        setLastPaintedTile(null);
    };

    const getStartFrame = (direction: DIRECTION) => {
        const directionMap = {
            [DIRECTION.DOWN]: 0,
            [DIRECTION.LEFT]: 3,
            [DIRECTION.UP]: 6,
            [DIRECTION.RIGHT]: 9
        };
        return directionMap[direction as keyof typeof directionMap] || 0;
    };

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full overflow-hidden"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
            style={{
                cursor: buildMode === 'paint' ? 'crosshair' : 'default',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                touchAction: 'none'
            }}
        >
            <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                className="h-full w-full"
                style={{
                    background: '#f0f8ff',
                    pointerEvents: 'none',
                }}
            />

            {/* Zoom Controls */}
            {enableZoom && fixedZoom === undefined && (zoomControls === 'buttons' || zoomControls === 'both') && (
                <div className="absolute right-4 bottom-4 z-30 flex flex-col gap-2 rounded-lg bg-white/90 p-2 shadow-lg backdrop-blur-sm">
                    <button
                        onClick={handleZoomIn}
                        disabled={zoomLevel >= MAX_ZOOM}
                        className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-xl font-bold text-gray-700 transition-all hover:bg-gray-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                        title="Zoom In"
                        aria-label="Zoom In"
                    >
                        +
                    </button>
                    <div className="flex h-8 items-center justify-center text-sm font-semibold text-gray-600">
                        {Math.round(zoomLevel * 100)}%
                    </div>
                    <button
                        onClick={handleZoomOut}
                        disabled={zoomLevel <= MIN_ZOOM}
                        className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-xl font-bold text-gray-700 transition-all hover:bg-gray-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                        title="Zoom Out"
                        aria-label="Zoom Out"
                    >
                        −
                    </button>
                </div>
            )}

            {/* Loading overlay before village is ready */}
            {!isCurrentVillageLoaded && (
                <div
                    className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#434243]"
                >
                    <Loader2 className="h-10 w-10 animate-spin text-[#C0A9F1]" />
                    <p className="mt-4 text-sm font-medium text-[#C0A9F1]">Loading village...</p>
                </div>
            )}

            {/* Render Report Icons per Village */}
            {isCurrentVillageLoaded && (() => {
                const tilesX = Math.ceil(canvasSize.width / tileSize);
                const tilesY = Math.ceil(canvasSize.height / tileSize);
                const half = VILLAGE_SIZE / 2;
                const REPORT_LOCAL_X = 9;
                const REPORT_LOCAL_Y = 1;

                return loadedVillagesArr.map((village) => {
                    const worldX = village.gridX * VILLAGE_SIZE - half + REPORT_LOCAL_X;
                    const worldY = village.gridY * VILLAGE_SIZE - half + REPORT_LOCAL_Y;
                    const screenX = worldX - cameraTilePosition.x;
                    const screenY = worldY - cameraTilePosition.y;

                    if (screenX < -1 || screenX > tilesX + 1 || screenY < -1 || screenY > tilesY + 1) {
                        return null;
                    }

                    // Distance from player to report icon center (icon is 2x2, center at +0.5, +0.5)
                    const dist = calculateDistance(
                        { x: worldX + 0.5, y: worldY + 0.5 },
                        worldPosition
                    );
                    const isNearby = dist <= BROADCAST_RADIUS;
                    const isClickable = isTouchDevice ? isNearby : true;

                    return (
                        <div
                            key={`report-${village.slug}`}
                            style={{
                                position: 'absolute',
                                left: `${screenX * tileSize - TILE_SIZE / 4}px`,
                                top: `${screenY * tileSize - TILE_SIZE / 4}px`,
                                width: `${tileSize * 2}px`,
                                height: `${tileSize * 2}px`,
                                pointerEvents: buildMode === 'paint' ? 'none' : isClickable ? 'auto' : 'none',
                                cursor: isClickable ? 'pointer' : 'default',
                                zIndex: Z_INDEX_OFFSETS.GAME + (worldY + 2) * 2,
                            }}
                            onClick={(e) => {
                                if (buildMode === 'paint' || !isClickable) return;
                                e.stopPropagation();
                                router.push(`/${village.slug}/report`);
                            }}
                        >
                            {/* Tooltip - only when nearby */}
                            {isNearby && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: '-28px',
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        fontSize: '11px',
                                        fontWeight: 'bold',
                                        color: '#fff',
                                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        whiteSpace: 'nowrap',
                                        zIndex: 10,
                                        pointerEvents: 'none',
                                        border: '1.5px solid #00E5FF',
                                    }}
                                >
                                    Click for Village Report
                                </div>
                            )}
                            <img
                                src="/map/report.png"
                                alt="Report"
                                style={{ width: 80, height: 80, imageRendering: 'pixelated' }}
                                draggable={false}
                            />
                        </div>
                    );
                });
            })()}

            {/* Render Agents using SpriteAnimator */}
            {isCurrentVillageLoaded && (() => {
                const tilesX = Math.ceil(canvasSize.width / tileSize);
                const tilesY = Math.ceil(canvasSize.height / tileSize);

                return agents.map((agent) => {
                const agentScreenX = agent.x - cameraTilePosition.x;
                const agentScreenY = agent.y - cameraTilePosition.y;

                if (agentScreenX < -1 || agentScreenX > tilesX + 1 || agentScreenY < -1 || agentScreenY > tilesY + 1) {
                    return null;
                }

                const agentIsMoving = agent.isMoving || false;
                const agentDirection = agent.direction || DIRECTION.DOWN;
                const agentStartFrame = getStartFrame(agentDirection);
                const agentSpriteUrl = agent.spriteUrl || '/sprite/sprite_user.png';
                const agentSpriteHeight = agent.spriteHeight || TILE_SIZE;

                const topOffset = agentSpriteHeight === TILE_SIZE ? agentSpriteHeight / 4 : agentSpriteHeight / 1.5;
                const agentZIndex = Z_INDEX_OFFSETS.GAME + (agent.y || 0) * 2;
                const isNearby = calculateDistance(agent, worldPosition) <= BROADCAST_RADIUS;

                return (
                    <div
                        key={agent.id}
                        style={{
                            position: 'absolute',
                            left: `${agentScreenX * tileSize - TILE_SIZE / 4}px`,
                            top: `${agentScreenY * tileSize - topOffset}px`,
                            width: `${tileSize}px`,
                            height: `${tileSize}px`,
                            pointerEvents: buildMode === 'paint' ? 'none' : 'auto',
                            cursor: buildMode === 'paint' ? 'default' : (onAgentClick ? 'pointer' : 'default'),
                            zIndex: agentZIndex
                        }}
                        onClick={(e) => {
                            if (buildMode === 'paint') return;
                            e.stopPropagation();
                            if (onAgentClick) {
                                onAgentClick(agent.id, agent.name);
                            }
                        }}
                    >
                        <CSSSprite
                            sprite={agentSpriteUrl}
                            width={TILE_SIZE}
                            height={agentSpriteHeight}
                            scale={1}
                            fps={6}
                            direction={'horizontal'}
                            shouldAnimate={agentIsMoving}
                            startFrame={agentStartFrame}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                top: '-20px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: '#fff',
                                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                whiteSpace: 'nowrap',
                                zIndex: 20,
                                pointerEvents: 'none',
                                ...(isNearby && {
                                    border: '1.5px solid #FFE500',
                                })
                            }}
                        >
                            {(() => {
                                const loadingIndicator = isAgentLoading(agent.id) ? ' 💬' : '';
                                return showCollisionMap && !hideCoordinates && agent.x !== undefined && agent.y !== undefined
                                    ? `${agent.name} (${agent.x}, ${agent.y})${loadingIndicator}`
                                    : `${agent.name}${loadingIndicator}`;
                            })()}
                        </div>
                    </div>
                );
            });
            })()}

            {/* Render Online Players */}
            {isCurrentVillageLoaded && (() => {
            const tilesX = Math.ceil(canvasSize.width / tileSize);
            const tilesY = Math.ceil(canvasSize.height / tileSize);
            return (onlinePlayers ?? []).map((player) => {
                const screenX = player.x - cameraTilePosition.x;
                const screenY = player.y - cameraTilePosition.y;

                if (screenX < -1 || screenX > tilesX + 1 || screenY < -1 || screenY > tilesY + 1) {
                    return null;
                }

                const startFrame = getStartFrame(player.direction || DIRECTION.DOWN);
                const spriteUrl = player.spriteKey ? `/sprite/${player.spriteKey}` : '/sprite/sprite_user.png';
                const zIndex = Z_INDEX_OFFSETS.GAME + player.y * 2;
                const displayName = player.displayName.length > 10
                    ? player.displayName.slice(0, 10) + '...'
                    : player.displayName;

                return (
                    <div
                        key={`online-${player.userId}`}
                        style={{
                            position: 'absolute',
                            left: `${screenX * tileSize - TILE_SIZE / 4}px`,
                            top: `${screenY * tileSize - 30}px`,
                            width: `${tileSize}px`,
                            height: `${tileSize}px`,
                            pointerEvents: 'none',
                            zIndex,
                            opacity: player.isLeaving ? 0 : 1,
                            transition: player.isLeaving ? 'opacity 1.5s ease-out' : 'none',
                        }}
                    >
                        <CSSSprite
                            sprite={spriteUrl}
                            width={TILE_SIZE}
                            height={50}
                            scale={1}
                            fps={6}
                            direction={'horizontal'}
                            shouldAnimate={false}
                            startFrame={startFrame}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                top: '-20px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: '#fff',
                                backgroundColor: 'rgba(30, 60, 120, 0.8)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                whiteSpace: 'nowrap',
                                zIndex: 20,
                                pointerEvents: 'none',
                            }}
                        >
                            {displayName}
                        </div>
                    </div>
                );
            });
            })()}

            {/* Render Player using SpriteAnimator */}
            {isCurrentVillageLoaded && (() => {
                const playerScreenTileX = worldPosition.x - cameraTilePosition.x;
                const playerScreenTileY = worldPosition.y - cameraTilePosition.y;
                const playerStartFrame = getStartFrame(playerDirection);
                const playerZIndex = Z_INDEX_OFFSETS.GAME + worldPosition.y * 2 + 1;

                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${playerScreenTileX * tileSize - TILE_SIZE / 4}px`,
                            top: `${playerScreenTileY * tileSize - 30}px`,
                            width: `${tileSize}px`,
                            height: `${tileSize}px`,
                            pointerEvents: 'none',
                            zIndex: playerZIndex
                        }}
                    >
                        <CSSSprite
                            sprite="/sprite/sprite_user.png"
                            width={TILE_SIZE}
                            height={50}
                            scale={1}
                            fps={6}
                            direction={'horizontal'}
                            shouldAnimate={playerIsMoving}
                            startFrame={playerStartFrame}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                top: '-20px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: '#000',
                                backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                whiteSpace: 'nowrap',
                                zIndex: 20,
                                pointerEvents: 'none',
                            }}
                        >
                            Me
                        </div>
                        {showCollisionMap && !hideCoordinates && (
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: '-18px',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                    color: '#fff',
                                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    whiteSpace: 'nowrap',
                                    zIndex: 20,
                                    pointerEvents: 'none'
                                }}
                            >
                                ({worldPosition.x}, {worldPosition.y})
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Visual preview outline for item/agent placement (hide on touch devices when position is selected) */}
            {buildMode === 'paint' && selectedItemDimensions && hoveredWorldCoords && !(isTouchDevice && selectedPosition) && (
                <>
                    {(() => {
                        const canvas = canvasRef.current;
                        if (!canvas) return null;

                        const { worldX, worldY } = hoveredWorldCoords;
                        const { width: itemWidth, height: itemHeight } = selectedItemDimensions;

                        // Calculate visible tiles
                        const tilesX = Math.ceil(canvasSize.width / tileSize);
                        const tilesY = Math.ceil(canvasSize.height / tileSize);

                        let hasCollision = false;
                        const tilesStatus: Array<{ screenX: number; screenY: number; blocked: boolean }> = [];

                        for (let dy = 0; dy < itemHeight; dy++) {
                            for (let dx = 0; dx < itemWidth; dx++) {
                                const checkX = worldX + dx;
                                const checkY = worldY + dy;

                                const screenTileX = checkX - cameraTilePosition.x;
                                const screenTileY = checkY - cameraTilePosition.y;

                                // Check if position is blocked
                                let blocked = false;

                                // First check: map permission from user store
                                const allowedMaps = useUserStore.getState().permissions?.permissions.placeAllowedMaps || [];
                                if (allowedMaps.length > 0 && !allowedMaps.includes('*')) {
                                    const { gridX, gridY } = worldToGrid(checkX, checkY);
                                    const villageSlug = useVillageStore.getState().getVillageSlugAtGrid(gridX, gridY);
                                    if (!villageSlug || !allowedMaps.includes(villageSlug)) {
                                        blocked = true;
                                    }
                                }

                                // Second check: position validity (collision, occupied, etc.)
                                if (!blocked) {
                                    if (isPositionValid) {
                                        blocked = !isPositionValid(checkX, checkY);
                                    } else {
                                        blocked = collisionMap[`${checkX},${checkY}`] === true;
                                    }
                                }

                                if (blocked) {
                                    hasCollision = true;
                                }

                                if (
                                    screenTileX >= 0 &&
                                    screenTileX < tilesX &&
                                    screenTileY >= 0 &&
                                    screenTileY < tilesY
                                ) {
                                    tilesStatus.push({ screenX: screenTileX, screenY: screenTileY, blocked });
                                }
                            }
                        }

                        const outlineColor = hasCollision ? 'rgba(255, 0, 0, 0.7)' : 'rgba(0, 255, 0, 0.7)';
                        const fillColor = hasCollision ? 'rgba(255, 0, 0, 0.15)' : 'rgba(0, 255, 0, 0.15)';

                        // Apply the same offset as useTiledMap.ts for tile rendering
                        const tileOffset = TILE_SIZE / 4;

                        return (
                            <>
                                {tilesStatus.map((tile, index) => (
                                    <div
                                        key={`preview-${tile.screenX}-${tile.screenY}-${index}`}
                                        style={{
                                            position: 'absolute',
                                            left: `${tile.screenX * tileSize - tileOffset}px`,
                                            top: `${tile.screenY * tileSize - tileOffset}px`,
                                            width: `${tileSize}px`,
                                            height: `${tileSize}px`,
                                            backgroundColor: tile.blocked ? 'rgba(255, 0, 0, 0.3)' : fillColor,
                                            border: `2px solid ${tile.blocked ? 'rgba(255, 0, 0, 0.9)' : outlineColor}`,
                                            pointerEvents: 'none',
                                            zIndex: 25,
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                ))}
                            </>
                        );
                    })()}
                </>
            )}

            {/* Selected position indicator for two-tap placement */}
            {buildMode === 'paint' && selectedPosition && (
                (() => {
                    const screenTileX = selectedPosition.x - cameraTilePosition.x;
                    const screenTileY = selectedPosition.y - cameraTilePosition.y;
                    const tileOffset = TILE_SIZE / 4;

                    // Only render if visible on screen
                    const tilesX = Math.ceil(canvasSize.width / tileSize);
                    const tilesY = Math.ceil(canvasSize.height / tileSize);
                    if (screenTileX < 0 || screenTileX >= tilesX || screenTileY < 0 || screenTileY >= tilesY) {
                        return null;
                    }

                    return (
                        <div
                            style={{
                                position: 'absolute',
                                left: `${screenTileX * tileSize - tileOffset}px`,
                                top: `${screenTileY * tileSize - tileOffset}px`,
                                width: `${tileSize}px`,
                                height: `${tileSize}px`,
                                backgroundColor: 'rgba(59, 130, 246, 0.3)',
                                border: '3px solid rgba(59, 130, 246, 0.9)',
                                borderRadius: '4px',
                                pointerEvents: 'none',
                                zIndex: 26,
                                boxSizing: 'border-box',
                                animation: 'pulse 1.5s ease-in-out infinite'
                            }}
                        />
                    );
                })()
            )}

        </div>
    );
}

export default TileMap;
