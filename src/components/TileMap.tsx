'use client';

import { useEffect, useRef, useState } from 'react';
import { SpriteAnimator } from 'react-sprite-animator';
import { TILE_SIZE, MAP_TILES, DIRECTION } from '@/constants/game';
import { useBuildStore, useChatStore } from '@/stores';
import { useTileBasedMap, drawTiledMap } from '@/hooks/useTileBasedMap';
import * as Sentry from '@sentry/nextjs';
import { AgentState } from '@/lib/agent';

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
    worldPosition: { x: number; y: number };
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
}

function TileMap({
    mapData,
    tileSize: baseTileSize,
    worldPosition,
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
    onAgentClick
}: TileMapProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [loadedImages, setLoadedImages] = useState<{ [key: string]: HTMLImageElement }>({});

    const [isPainting, setIsPainting] = useState(false);
    const [lastPaintedTile, setLastPaintedTile] = useState<{ x: number; y: number } | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

    // Tile-based map loading for layer 0 and layer 1
    const { loadedTiles: layer0Tiles, tileConfig } = useTileBasedMap(
        'land_layer_0',
        worldPosition,
        canvasSize,
        baseTileSize
    );

    const { loadedTiles: layer1Tiles } = useTileBasedMap(
        'land_layer_1',
        worldPosition,
        canvasSize,
        baseTileSize
    );
    const [hoveredTile, setHoveredTile] = useState<{ x: number; y: number; layer: 0 | 1 | 2 } | null>(null);
    const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
    const [hoveredWorldCoords, setHoveredWorldCoords] = useState<{ worldX: number; worldY: number } | null>(null);

    const [zoomLevel, setZoomLevel] = useState(fixedZoom !== undefined ? fixedZoom : 1.0);
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2.0;
    const ZOOM_STEP = 0.25;

    const tileSize = baseTileSize * (fixedZoom !== undefined ? fixedZoom : zoomLevel);

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

    const getWorldCoordinatesFromEvent = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const canvasX = (event.clientX - rect.left) * scaleX;
        const canvasY = (event.clientY - rect.top) * scaleY;

        const screenTileX = Math.floor(canvasX / tileSize);
        const screenTileY = Math.floor(canvasY / tileSize);

        const tilesX = Math.ceil(canvasSize.width / tileSize);
        const tilesY = Math.ceil(canvasSize.height / tileSize);
        const halfTilesX = Math.floor(tilesX / 2);
        const halfTilesY = Math.floor(tilesY / 2);

        let cameraTileX = worldPosition.x - halfTilesX;
        let cameraTileY = worldPosition.y - halfTilesY;
        cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
        cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

        if (screenTileX >= 0 && screenTileX < tilesX && screenTileY >= 0 && screenTileY < tilesY) {
            const worldX = Math.floor(cameraTileX + screenTileX);
            const worldY = Math.floor(cameraTileY + screenTileY);

            return { worldX, worldY };
        }

        return null;
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

        const touch = event.touches[0];

        if (buildMode === 'paint') {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            const canvasX = (touch.clientX - rect.left) * scaleX;
            const canvasY = (touch.clientY - rect.top) * scaleY;

            const screenTileX = Math.floor(canvasX / tileSize);
            const screenTileY = Math.floor(canvasY / tileSize);

            const tilesX = Math.ceil(canvasSize.width / tileSize);
            const tilesY = Math.ceil(canvasSize.height / tileSize);
            const halfTilesX = Math.floor(tilesX / 2);
            const halfTilesY = Math.floor(tilesY / 2);

            let cameraTileX = worldPosition.x - halfTilesX;
            let cameraTileY = worldPosition.y - halfTilesY;
            cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
            cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

            if (screenTileX >= 0 && screenTileX < tilesX && screenTileY >= 0 && screenTileY < tilesY) {
                const worldX = Math.floor(cameraTileX + screenTileX);
                const worldY = Math.floor(cameraTileY + screenTileY);

                setIsPainting(true);
                paintTileAt(worldX, worldY);
            }
        }
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (buildMode !== 'paint' || !isPainting || event.touches.length === 0) return;

        const touch = event.touches[0];
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const canvasX = (touch.clientX - rect.left) * scaleX;
        const canvasY = (touch.clientY - rect.top) * scaleY;

        const screenTileX = Math.floor(canvasX / tileSize);
        const screenTileY = Math.floor(canvasY / tileSize);

        const tilesX = Math.ceil(canvasSize.width / tileSize);
        const tilesY = Math.ceil(canvasSize.height / tileSize);
        const halfTilesX = Math.floor(tilesX / 2);
        const halfTilesY = Math.floor(tilesY / 2);

        let cameraTileX = worldPosition.x - halfTilesX;
        let cameraTileY = worldPosition.y - halfTilesY;
        cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
        cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

        if (screenTileX >= 0 && screenTileX < tilesX && screenTileY >= 0 && screenTileY < tilesY) {
            const worldX = Math.floor(cameraTileX + screenTileX);
            const worldY = Math.floor(cameraTileY + screenTileY);

            paintTileAt(worldX, worldY);
        }
    };

    const handleTouchEnd = () => {
        setIsPainting(false);
        setLastPaintedTile(null);
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            Sentry.addBreadcrumb({
                category: 'tilemap',
                message: 'Canvas ref is null',
                level: 'warning'
            });
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            Sentry.addBreadcrumb({
                category: 'tilemap',
                message: 'Failed to get 2D context',
                level: 'error'
            });
            return;
        }

        // Start performance measurement
        const renderStart = performance.now();

        Sentry.addBreadcrumb({
            category: 'tilemap',
            message: 'Starting canvas render',
            level: 'info',
            data: {
                canvasSize: canvasSize,
                worldPosition: worldPosition,
                layer0TilesCount: layer0Tiles.size,
                layer1TilesCount: layer1Tiles.size
            }
        });

        // Create offscreen canvas for double buffering to prevent flickering
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = canvas.width;
        offscreenCanvas.height = canvas.height;
        const offscreenCtx = offscreenCanvas.getContext('2d');

        if (!offscreenCtx) return;

        // Use offscreen context for all drawing operations
        const renderCtx = offscreenCtx;

        renderCtx.fillStyle = '#f0f8ff';
        renderCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

        const tilesX = Math.ceil(canvasSize.width / tileSize);
        const tilesY = Math.ceil(canvasSize.height / tileSize);
        const halfTilesX = Math.floor(tilesX / 2);
        const halfTilesY = Math.floor(tilesY / 2);

        let cameraTileX = worldPosition.x - halfTilesX;
        let cameraTileY = worldPosition.y - halfTilesY;

        cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
        cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

        // Draw layer 0 (background) using tile-based rendering
        if (layerVisibility[0]) {
            drawTiledMap(renderCtx, layer0Tiles, tileConfig, worldPosition, canvasSize, baseTileSize);
        }

        // Draw layer 1 using tile-based rendering
        if (layerVisibility[1]) {
            drawTiledMap(renderCtx, layer1Tiles, tileConfig, worldPosition, canvasSize, baseTileSize);
        }

        const screenTileWidth = canvas.width / tilesX;
        const screenTileHeight = canvas.height / tilesY;

        if (isLayeredTiles(customTiles)) {
            [0, 1, 2].forEach((layerIndex) => {
                if (!layerVisibility[layerIndex]) return;

                const layerKey = `layer${layerIndex}` as keyof TileLayers;
                const layer = customTiles[layerKey];

                if (layer) {
                    for (let y = 0; y < tilesY; y++) {
                        for (let x = 0; x < tilesX; x++) {
                            const worldTileX = Math.floor(cameraTileX + x);
                            const worldTileY = Math.floor(cameraTileY + y);
                            const tileKey = `${worldTileX},${worldTileY}`;
                            const customTileData = layer[tileKey];

                            if (customTileData) {
                                if (typeof customTileData === 'string') {
                                    if (loadedImages[customTileData]) {
                                        const img = loadedImages[customTileData];
                                        const pixelX = x * screenTileWidth;
                                        const pixelY = y * screenTileHeight;
                                        renderCtx.drawImage(img, pixelX, pixelY, screenTileWidth, screenTileHeight);
                                    }
                                } else if (customTileData && typeof customTileData === 'object') {
                                    if (!customTileData.isSecondaryTile) {
                                        const { image, width, height } = customTileData;
                                        if (loadedImages[image]) {
                                            const img = loadedImages[image];
                                            const pixelX = x * screenTileWidth;
                                            const pixelY = y * screenTileHeight;

                                            const itemWidth = width * screenTileWidth;
                                            const itemHeight = height * screenTileHeight;

                                            renderCtx.drawImage(img, pixelX, pixelY, itemWidth, itemHeight);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        } else {
            for (let y = 0; y < tilesY; y++) {
                for (let x = 0; x < tilesX; x++) {
                    const worldTileX = Math.floor(cameraTileX + x);
                    const worldTileY = Math.floor(cameraTileY + y);
                    const tileKey = `${worldTileX},${worldTileY}`;
                    const customTileImage = customTiles[tileKey];

                    if (customTileImage && loadedImages[customTileImage]) {
                        const img = loadedImages[customTileImage];

                        const pixelX = x * screenTileWidth;
                        const pixelY = y * screenTileHeight;

                        renderCtx.drawImage(img, pixelX, pixelY, screenTileWidth, screenTileHeight);
                    }
                }
            }
        }

        if (showCollisionMap) {
            for (let y = 0; y < tilesY; y++) {
                for (let x = 0; x < tilesX; x++) {
                    const worldTileX = Math.floor(cameraTileX + x);
                    const worldTileY = Math.floor(cameraTileY + y);

                    const hasPlayer = worldTileX === worldPosition.x && worldTileY === worldPosition.y;

                    const agentAtPosition = agents.find((agent) => agent.x === worldTileX && agent.y === worldTileY);

                    if (hasPlayer) {
                        renderCtx.fillStyle = 'rgba(0, 0, 0, 0.5)'; // Black with 50% opacity
                        renderCtx.fillRect(x * screenTileWidth, y * screenTileHeight, screenTileWidth, screenTileHeight);
                    } else if (agentAtPosition) {
                        const agentColor = agentAtPosition.color;

                        const r = parseInt(agentColor.slice(1, 3), 16);
                        const g = parseInt(agentColor.slice(3, 5), 16);
                        const b = parseInt(agentColor.slice(5, 7), 16);
                        renderCtx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
                        renderCtx.fillRect(x * screenTileWidth, y * screenTileHeight, screenTileWidth, screenTileHeight);
                    } else {
                        const tileKey = `${worldTileX},${worldTileY}`;
                        if (collisionMap[tileKey]) {
                            renderCtx.fillStyle = 'rgba(255, 0, 0, 0.5)'; // Red with 50% opacity
                            renderCtx.fillRect(x * screenTileWidth, y * screenTileHeight, screenTileWidth, screenTileHeight);
                        }
                    }
                }
            }

            renderCtx.strokeStyle = 'rgba(0, 0, 0, 0.3)'; // Black with 30% opacity
            renderCtx.lineWidth = 1;
            for (let y = 0; y <= tilesY; y++) {
                renderCtx.beginPath();
                renderCtx.moveTo(0, y * screenTileHeight);
                renderCtx.lineTo(canvas.width, y * screenTileHeight);
                renderCtx.stroke();
            }
            for (let x = 0; x <= tilesX; x++) {
                renderCtx.beginPath();
                renderCtx.moveTo(x * screenTileWidth, 0);
                renderCtx.lineTo(x * screenTileWidth, canvas.height);
                renderCtx.stroke();
            }
        }

        // End performance measurement
        const renderEnd = performance.now();
        const renderTime = renderEnd - renderStart;

        // Log slow renders
        if (renderTime > 16) { // More than one frame at 60fps
            Sentry.addBreadcrumb({
                category: 'tilemap.performance',
                message: 'Slow canvas render detected',
                level: 'warning',
                data: {
                    renderTime: `${renderTime.toFixed(2)}ms`,
                    canvasSize: canvasSize,
                    layer0TilesCount: layer0Tiles.size,
                    layer1TilesCount: layer1Tiles.size,
                    worldPosition: worldPosition
                }
            });
        }

        // Track very slow renders as errors
        if (renderTime > 50) {
            Sentry.captureMessage('Very slow TileMap render', {
                level: 'warning',
                extra: {
                    renderTime: `${renderTime.toFixed(2)}ms`,
                    canvasSize: canvasSize,
                    layer0TilesCount: layer0Tiles.size,
                    layer1TilesCount: layer1Tiles.size,
                    worldPosition: worldPosition,
                    showCollisionMap: showCollisionMap
                }
            });
        }

        // Copy offscreen canvas to main canvas (prevents flickering)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(offscreenCanvas, 0, 0);
    }, [
        mapData,
        tileSize,
        worldPosition.x,
        worldPosition.y,
        customTiles,
        loadedImages,
        layerVisibility,
        layer0Tiles,
        layer1Tiles,
        canvasSize,
        collisionMap,
        showCollisionMap,
        baseTileSize,
        tileConfig
    ]);

    const tilesX = Math.ceil(canvasSize.width / tileSize);
    const tilesY = Math.ceil(canvasSize.height / tileSize);
    const halfTilesX = Math.floor(tilesX / 2);
    const halfTilesY = Math.floor(tilesY / 2);

    let cameraTileX = worldPosition.x - halfTilesX;
    let cameraTileY = worldPosition.y - halfTilesY;
    cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
    cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

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
                const agentScreenX = agent.x - cameraTileX;
                const agentScreenY = agent.y - cameraTileY;

                if (agentScreenX < -1 || agentScreenX > tilesX || agentScreenY < -1 || agentScreenY > tilesY) {
                    return null;
                }

                const agentIsMoving = agent.isMoving || false;
                const agentDirection = agent.direction || DIRECTION.DOWN;
                const agentStartFrame = getStartFrame(agentDirection);
                const agentSpriteUrl = agent.spriteUrl || '/sprite/sprite_user.png';
                const agentSpriteHeight = agent.spriteHeight || TILE_SIZE;

                const topOffset = agentSpriteHeight === TILE_SIZE ? agentSpriteHeight / 4 : agentSpriteHeight / 1.5;

                return (
                    <div
                        key={agent.id}
                        style={{
                            position: 'absolute',
                            left: `${agentScreenX * tileSize - TILE_SIZE / 4}px`,
                            top: `${agentScreenY * tileSize - topOffset}px`,
                            width: `${tileSize}px`,
                            height: `${tileSize}px`,
                            pointerEvents: 'auto',
                            cursor: onAgentClick ? 'pointer' : 'default'
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onAgentClick) {
                                onAgentClick(agent.id, agent.name);
                            }
                        }}
                    >
                        <SpriteAnimator
                            key={agent.id}
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
                const playerScreenTileX = worldPosition.x - cameraTileX;
                const playerScreenTileY = worldPosition.y - cameraTileY;
                const playerStartFrame = getStartFrame(playerDirection);

                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${playerScreenTileX * tileSize - TILE_SIZE / 4}px`,
                            top: `${playerScreenTileY * tileSize - 60}px`,
                            width: `${tileSize}px`,
                            height: `${tileSize}px`,
                            pointerEvents: 'none',
                            zIndex: 10
                        }}
                    >
                        <SpriteAnimator
                            key={`player-${playerDirection}`}
                            sprite="/sprite/sprite_user.png"
                            width={TILE_SIZE}
                            height={86}
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
            {buildMode === 'paint' && onDeleteTile && isLayeredTiles(customTiles) && canvasRef.current && (
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
                                        {/* Delete button - centered X, shown on hover */}
                                        <button
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
            )}

            {/* Visual preview outline for multi-tile item placement */}
            {buildMode === 'paint' && selectedItemDimensions && hoveredWorldCoords && (
                <>
                    {(() => {
                        const canvas = canvasRef.current;
                        if (!canvas) return null;

                        const { worldX, worldY } = hoveredWorldCoords;
                        const { width: itemWidth, height: itemHeight } = selectedItemDimensions;

                        let hasCollision = false;
                        const tilesStatus: Array<{ screenX: number; screenY: number; blocked: boolean }> = [];

                        for (let dy = 0; dy < itemHeight; dy++) {
                            for (let dx = 0; dx < itemWidth; dx++) {
                                const checkX = worldX + dx;
                                const checkY = worldY + dy;

                                const screenTileX = checkX - cameraTileX;
                                const screenTileY = checkY - cameraTileY;

                                const isBlockedTile = collisionMap[`${checkX},${checkY}`] === true;

                                const outOfBounds = checkX < 0 || checkX >= 105 || checkY < 0 || checkY >= 105;

                                const blocked = isBlockedTile || outOfBounds;
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

                        const screenTileWidth = canvas.width / tilesX;
                        const screenTileHeight = canvas.height / tilesY;

                        const outlineColor = hasCollision ? 'rgba(255, 0, 0, 0.7)' : 'rgba(0, 255, 0, 0.7)';
                        const fillColor = hasCollision ? 'rgba(255, 0, 0, 0.15)' : 'rgba(0, 255, 0, 0.15)';

                        return (
                            <>
                                {tilesStatus.map((tile, index) => (
                                    <div
                                        key={`preview-${tile.screenX}-${tile.screenY}-${index}`}
                                        style={{
                                            position: 'absolute',
                                            left: `${tile.screenX * screenTileWidth}px`,
                                            top: `${tile.screenY * screenTileHeight}px`,
                                            width: `${screenTileWidth}px`,
                                            height: `${screenTileHeight}px`,
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

            {/* Visual feedback for blocked tiles when hovering (single tile - legacy) */}
            {buildMode === 'paint' && !selectedItemDimensions && mousePosition && (
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
            )}
        </div>
    );
}

export default TileMap;
