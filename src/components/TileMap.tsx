'use client';

import { useEffect, useRef, useState } from 'react';
import { SpriteAnimator } from 'react-sprite-animator';
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, DIRECTION } from '@/constants/game';
import { getMapNameFromCoordinates } from '@/lib/map-utils';
import { useBuildStore, useChatStore, useGameStateStore, useUserStore } from '@/stores';
import * as Sentry from '@sentry/nextjs';
import { AgentState } from '@/lib/agent';
import { useTiledMap } from '@/hooks/useTiledMap';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { useVillageStore } from '@/stores/useVillageStore';

// Data structure for multi-tile items
interface ItemTileData {
    image: string;
    width: number; // in tiles
    height: number; // in tiles
    topLeftX: number; // original placement X coordinate
    topLeftY: number; // original placement Y coordinate
    isSecondaryTile?: boolean; // true for tiles that are not the top-left anchor
}

type TileLayers = {
    layer0: { [key: string]: string };
    layer1: { [key: string]: string | ItemTileData };
    layer2: { [key: string]: string };
};

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
}

function TileMap({
    mapData,
    tileSize: baseTileSize,
    agents = [],
    customTiles = {},
    layerVisibility = { 0: true, 1: true, 2: true },
    buildMode = 'view',
    onTileClick,
    onDeleteTile,
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
    selectedPosition = null
}: TileMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [loadedImages, setLoadedImages] = useState<{ [key: string]: HTMLImageElement }>({});

    const [isPainting, setIsPainting] = useState(false);
    const [lastPaintedTile, setLastPaintedTile] = useState<{ x: number; y: number } | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

    const { worldPosition } = useGameStateStore();
    
    const [zoomLevel, setZoomLevel] = useState(fixedZoom !== undefined ? fixedZoom : 1.0);
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2.0;
    const ZOOM_STEP = 0.25;

    const tileSize = baseTileSize * (fixedZoom !== undefined ? fixedZoom : zoomLevel);
    
    const { canvasRef, cameraTilePosition } = useTiledMap(
        canvasSize,
        tileSize
    );
  
    const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
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

    const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
        if (!enableZoom || (zoomControls !== 'wheel' && zoomControls !== 'both')) return;

        event.preventDefault();

        if (event.deltaY < 0) {
            handleZoomIn();
        } else if (event.deltaY > 0) {
            handleZoomOut();
        }
    };

    const isLayeredTiles = (tiles: TileLayers | { [key: string]: string }): tiles is TileLayers => {
        return tiles && typeof tiles === 'object' && ('layer0' in tiles || 'layer1' in tiles || 'layer2' in tiles);
    };

    useEffect(() => {
        let imagesToLoad: string[] = [];

        if (isLayeredTiles(customTiles)) {
            Object.keys(customTiles).forEach((layerKey) => {
                const layer = customTiles[layerKey as keyof TileLayers];
                if (layer) {
                    Object.values(layer).forEach((tileData) => {
                        if (typeof tileData === 'string') {
                            imagesToLoad.push(tileData);
                        } else if (tileData && typeof tileData === 'object' && tileData.image) {
                            imagesToLoad.push(tileData.image);
                        }
                    });
                }
            });
        } else {
            imagesToLoad = Object.values(customTiles) as string[];
        }

        const uniqueImages = [...new Set(imagesToLoad)];

        uniqueImages.forEach((imageUrl) => {
            if (loadedImages[imageUrl]) return;

            const img = new Image();
            img.onload = () => {
                setLoadedImages((prev) => ({
                    ...prev,
                    [imageUrl]: img
                }));
            };
            img.onerror = (error) => {
                // Log the error to Sentry for tracking
                Sentry.captureException(new Error(`Failed to load tile image: ${imageUrl}`), {
                    level: 'warning',
                    extra: {
                        imageUrl,
                        errorEvent: error
                    }
                });
                
                // Add breadcrumb for debugging
                Sentry.addBreadcrumb({
                    category: 'tilemap.image',
                    message: 'Failed to load custom tile image',
                    level: 'warning',
                    data: {
                        imageUrl
                    }
                });
            };
            img.src = imageUrl;
        });
    }, [customTiles]);

    // Shared coordinate calculation for both mouse and touch events
    const getWorldCoordinatesFromClientPos = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const { isCurrentVillageLoaded } = useVillageStore.getState();
        if (!isCurrentVillageLoaded) return null;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const canvasX = (clientX - rect.left) * scaleX;
        const canvasY = (clientY - rect.top) * scaleY;

        const screenTileX = Math.floor(canvasX / tileSize);
        const screenTileY = Math.floor(canvasY / tileSize);

        // Calculate visible tiles
        const tilesX = Math.ceil(canvasSize.width / tileSize);
        const tilesY = Math.ceil(canvasSize.height / tileSize);
        const halfTilesX = Math.floor(tilesX / 2);
        const halfTilesY = Math.floor(tilesY / 2);

        // Camera position (no clamping - village boundaries handle movement limits)
        const cameraTileX = worldPosition.x - halfTilesX;
        const cameraTileY = worldPosition.y - halfTilesY;

        if (screenTileX >= 0 && screenTileX < tilesX && screenTileY >= 0 && screenTileY < tilesY) {
            // Calculate world coordinates in center-based system
            const worldX = cameraTileX + screenTileX;
            const worldY = cameraTileY + screenTileY;

            return { worldX, worldY };
        }

        return null;
    };

    const getWorldCoordinatesFromEvent = (event: React.MouseEvent<HTMLCanvasElement>) => {
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

    const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (buildMode === 'paint') {
            const coords = getWorldCoordinatesFromEvent(event);
            if (coords) {
                setIsPainting(true);
                paintTileAt(coords.worldX, coords.worldY);
            }
        }
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const coords = getWorldCoordinatesFromEvent(event);

        if (buildMode === 'paint') {
            const canvas = canvasRef.current;
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                setMousePosition({
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top
                });
            }

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
        setMousePosition(null);
    };

    const handleTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (event.touches.length === 0) return;

        // Prevent browser from simulating mouse events after touch
        event.preventDefault();

        // Mark as touch device to hide hover preview
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

    const handleTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (buildMode !== 'paint' || !isPainting || event.touches.length === 0) return;

        const touch = event.touches[0];
        const coords = getWorldCoordinatesFromClientPos(touch.clientX, touch.clientY);
        if (coords) {
            paintTileAt(coords.worldX, coords.worldY);
        }
    };

    const handleTouchEnd = (event: React.TouchEvent<HTMLCanvasElement>) => {
        // Prevent browser from simulating mouse events after touch
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

    const getCustomTilesAtPosition = (worldX: number, worldY: number) => {
        const key = `${worldX},${worldY}`;
        const tiles: Array<{ layer: 0 | 1 | 2; image: string; key: string; isSecondaryTile?: boolean }> = [];

        if (isLayeredTiles(customTiles)) {
            [0, 1, 2].forEach((layerIndex) => {
                const layerKey = `layer${layerIndex}` as keyof TileLayers;
                const layer = customTiles[layerKey];
                if (layer && layer[key]) {
                    const tileData = layer[key];
                    let imageUrl: string;
                    let isSecondary = false;

                    if (typeof tileData === 'string') {
                        imageUrl = tileData;
                    } else if (tileData && typeof tileData === 'object') {
                        imageUrl = tileData.image;
                        isSecondary = tileData.isSecondaryTile || false;
                    } else {
                        return; // Skip invalid data
                    }

                    tiles.push({
                        layer: layerIndex as 0 | 1 | 2,
                        image: imageUrl,
                        key,
                        isSecondaryTile: isSecondary
                    });
                }
            });
        }

        return tiles;
    };

    return (
        <div ref={containerRef} className="relative h-full w-full">
            <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                className="h-full w-full"
                style={{
                    background: '#f0f8ff',
                    cursor: buildMode === 'paint' ? 'crosshair' : 'default',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    MozUserSelect: 'none',
                    touchAction: 'none'
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onWheel={handleWheel}
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

            {/* Render Agents using SpriteAnimator */}
            {agents.map((agent) => {
                const agentScreenX = agent.x - cameraTilePosition.x;
                const agentScreenY = agent.y - cameraTilePosition.y;

                // Skip rendering agents far outside the viewport
                if (agentScreenX < -1 || agentScreenX > MAP_WIDTH + 1 || agentScreenY < -1 || agentScreenY > MAP_HEIGHT + 1) {
                    return null;
                }

                const agentIsMoving = agent.isMoving || false;
                const agentDirection = agent.direction || DIRECTION.DOWN;
                const agentStartFrame = getStartFrame(agentDirection);
                const agentSpriteUrl = agent.spriteUrl || '/sprite/sprite_user.png';
                const agentSpriteHeight = agent.spriteHeight || TILE_SIZE;

                const topOffset = agentSpriteHeight === TILE_SIZE ? agentSpriteHeight / 4 : agentSpriteHeight / 1.5;
                const agentZIndex = Z_INDEX_OFFSETS.GAME + (agent.y || 0);

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
                        <SpriteAnimator
                            key={`${agent.id}-${agentDirection}`}
                            sprite={agentSpriteUrl}
                            width={TILE_SIZE}
                            height={agentSpriteHeight}
                            scale={1}
                            fps={6}
                            frameCount={agentStartFrame + 3}
                            direction={'horizontal'}
                            shouldAnimate={agentIsMoving}
                            startFrame={agentStartFrame}
                        />
                        {/* Show agent name and coordinates */}
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
                                pointerEvents: 'none'
                            }}
                        >
                            {showCollisionMap && !hideCoordinates && agent.x !== undefined && agent.y !== undefined
                                ? `${agent.name} (${agent.x}, ${agent.y})${isAgentLoading(agent.id) ? ' 💬' : ''}`
                                : `${agent.name}${isAgentLoading(agent.id) ? ' 💬' : ''}`}
                        </div>
                    </div>
                );
            })}

            {/* Render Player using SpriteAnimator */}
            {(() => {
                const playerScreenTileX = worldPosition.x - cameraTilePosition.x;
                const playerScreenTileY = worldPosition.y - cameraTilePosition.y;
                const playerStartFrame = getStartFrame(playerDirection);
                const playerZIndex = Z_INDEX_OFFSETS.GAME + worldPosition.y;

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
                        <SpriteAnimator
                            key={`player-${playerDirection}`}
                            sprite="/sprite/sprite_user.png"
                            width={TILE_SIZE}
                            height={50}
                            scale={1}
                            fps={6}
                            frameCount={playerStartFrame + 3}
                            direction={'horizontal'}
                            shouldAnimate={playerIsMoving}
                            startFrame={playerStartFrame}
                        />
                        {/* Show player coordinates when grid is visible */}
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

            {/* Render delete buttons for placed items in build mode */}
            {/* {buildMode === 'paint' && onDeleteTile && isLayeredTiles(customTiles) && canvasRef.current && (
                <>
                    {(() => {
                        const canvas = canvasRef.current;
                        if (!canvas) return null;

                        const screenTileWidth = canvas.width / tilesX;
                        const screenTileHeight = canvas.height / tilesY;

                        return Array.from({ length: tilesY }).map((_, screenY) =>
                            Array.from({ length: tilesX }).map((_, screenX) => {
                                const worldTileX = Math.floor(cameraTileX + screenX);
                                const worldTileY = Math.floor(cameraTileY + screenY);
                                const tiles = getCustomTilesAtPosition(worldTileX, worldTileY);

                                const layer1Tile = tiles.find((t) => t.layer === 1);
                                if (!layer1Tile) return null;

                                return (
                                    <div
                                        key={`delete-${worldTileX}-${worldTileY}`}
                                        className="group absolute"
                                        style={{
                                            left: `${screenX * screenTileWidth}px`,
                                            top: `${screenY * screenTileHeight}px`,
                                            width: `${screenTileWidth}px`,
                                            height: `${screenTileHeight}px`,
                                            pointerEvents: 'auto',
                                            zIndex: 15
                                        }}
                                    >
                                        {/* <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteTile(layer1Tile.layer, layer1Tile.key);
                                            }}
                                            className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-red-500 opacity-0 drop-shadow-lg transition-all group-hover:opacity-100 hover:scale-125 hover:text-red-600"
                                            style={{
                                                fontSize: '36px',
                                                fontWeight: 'bold',
                                                lineHeight: '1',
                                                textShadow: '0 0 4px white, 0 0 8px white'
                                            }}
                                            title="Delete item"
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            })
                        );
                    })()}
                </>
            )}} */}

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
                                    const tileMapName = getMapNameFromCoordinates(checkX, checkY);
                                    if (!tileMapName || !allowedMaps.includes(tileMapName)) {
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

            {/* Visual feedback for blocked tiles when hovering (single tile - legacy) */}
            {/* {buildMode === 'paint' && !selectedItemDimensions && mousePosition && (
                <>
                    {(() => {
                        const canvas = canvasRef.current;
                        if (!canvas) return null;

                        const rect = canvas.getBoundingClientRect();
                        const scaleX = canvas.width / rect.width;
                        const scaleY = canvas.height / rect.height;

                        const canvasX = mousePosition.x * scaleX;
                        const canvasY = mousePosition.y * scaleY;

                        const screenTileX = Math.floor(canvasX / tileSize);
                        const screenTileY = Math.floor(canvasY / tileSize);

                        const worldX = Math.floor(cameraTileX + screenTileX);
                        const worldY = Math.floor(cameraTileY + screenTileY);

                        const isBlockedTile = collisionMap[`${worldX},${worldY}`] === true;

                        if (!isBlockedTile) return null;

                        const screenTileWidth = canvas.width / tilesX;
                        const screenTileHeight = canvas.height / tilesY;

                        return (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `${screenTileX * screenTileWidth}px`,
                                    top: `${screenTileY * screenTileHeight}px`,
                                    width: `${screenTileWidth}px`,
                                    height: `${screenTileHeight}px`,
                                    backgroundColor: 'rgba(255, 0, 0, 0.4)',
                                    border: '2px solid rgba(255, 0, 0, 0.8)',
                                    pointerEvents: 'none',
                                    zIndex: 20
                                }}
                            />
                        );
                    })()}
                </>
            )} */}
        </div>
    );
}

export default TileMap;
