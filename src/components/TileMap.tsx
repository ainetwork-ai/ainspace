'use client';

import { useEffect, useRef, useState } from 'react';
import { SpriteAnimator } from 'react-sprite-animator';
import { TILE_SIZE, MAP_TILES } from '@/constants/game';
import { useBuildStore } from '@/stores';

interface Agent {
    id: string;
    screenX: number;
    screenY: number;
    x?: number; // world position
    y?: number; // world position
    color: string;
    name: string;
    hasCharacterImage?: boolean;
    direction?: 'up' | 'down' | 'left' | 'right';
    isMoving?: boolean;
    spriteUrl?: string;
    spriteHeight?: number;
    spriteWidth?: number;
}

type TileLayers = {
    layer0: { [key: string]: string };
    layer1: { [key: string]: string };
    layer2: { [key: string]: string };
};

interface TileMapProps {
    mapData: number[][];
    tileSize: number;
    playerPosition: { x: number; y: number };
    worldPosition: { x: number; y: number };
    agents?: Agent[];
    customTiles?: TileLayers | { [key: string]: string };
    layerVisibility?: { [key: number]: boolean };
    buildMode?: 'view' | 'paint';
    onTileClick?: (x: number, y: number) => void;
    backgroundImageSrc?: string;
    layer1ImageSrc?: string;
    playerDirection?: 'up' | 'down' | 'left' | 'right';
    playerIsMoving?: boolean;
    collisionMap?: { [key: string]: boolean };
}

export default function TileMap({
    mapData,
    tileSize,
    playerPosition,
    worldPosition,
    agents = [],
    customTiles = {},
    layerVisibility = { 0: true, 1: true, 2: true },
    buildMode = 'view',
    onTileClick,
    backgroundImageSrc,
    layer1ImageSrc,
    playerDirection = 'down',
    playerIsMoving = false,
    collisionMap = {}
}: TileMapProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [loadedImages, setLoadedImages] = useState<{ [key: string]: HTMLImageElement }>({});
    const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
    const [layer1Image, setLayer1Image] = useState<HTMLImageElement | null>(null);
    const [isPainting, setIsPainting] = useState(false);
    const [lastPaintedTile, setLastPaintedTile] = useState<{ x: number; y: number } | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

    // Use global state for collision map visibility
    const { showCollisionMap, toggleCollisionMap } = useBuildStore();

    // Load background image
    useEffect(() => {
        if (!backgroundImageSrc) {
            setBackgroundImage(null);
            return;
        }

        const img = new Image();
        img.onload = () => {
            setBackgroundImage(img);
        };
        img.src = backgroundImageSrc;
    }, [backgroundImageSrc]);

    // Load layer1 image
    useEffect(() => {
        if (!layer1ImageSrc) {
            setLayer1Image(null);
            return;
        }

        const img = new Image();
        img.onload = () => {
            setLayer1Image(img);
        };
        img.src = layer1ImageSrc;
    }, [layer1ImageSrc]);

    // Detect canvas size based on container
    useEffect(() => {
        const updateCanvasSize = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setCanvasSize({
                    width: rect.width,
                    height: rect.height
                });
            }
        };

        updateCanvasSize();
        window.addEventListener('resize', updateCanvasSize);
        return () => window.removeEventListener('resize', updateCanvasSize);
    }, []);

    // Toggle collision map display with Ctrl+J
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

    // Check if customTiles is using layer structure
    const isLayeredTiles = (tiles: TileLayers | { [key: string]: string }): tiles is TileLayers => {
        return tiles && typeof tiles === 'object' && ('layer0' in tiles || 'layer1' in tiles || 'layer2' in tiles);
    };

    // Load custom tile images
    useEffect(() => {
        let imagesToLoad: string[] = [];

        if (isLayeredTiles(customTiles)) {
            // Extract images from all layers
            Object.keys(customTiles).forEach((layerKey) => {
                const layer = customTiles[layerKey as keyof TileLayers];
                if (layer) {
                    imagesToLoad.push(...Object.values(layer));
                }
            });
        } else {
            // Legacy single layer support
            imagesToLoad = Object.values(customTiles);
        }

        const uniqueImages = [...new Set(imagesToLoad)];

        uniqueImages.forEach((imageUrl) => {
            if (!loadedImages[imageUrl]) {
                const img = new Image();
                img.onload = () => {
                    setLoadedImages((prev) => ({
                        ...prev,
                        [imageUrl]: img
                    }));
                };
                img.src = imageUrl;
            }
        });
    }, [customTiles, loadedImages]);

    // Convert mouse event to world coordinates
    const getWorldCoordinatesFromEvent = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        // Get position relative to canvas, accounting for scaling
        const canvasX = (event.clientX - rect.left) * scaleX;
        const canvasY = (event.clientY - rect.top) * scaleY;

        // Convert to tile coordinates (screen space)
        const screenTileX = Math.floor(canvasX / tileSize);
        const screenTileY = Math.floor(canvasY / tileSize);

        // Calculate visible tiles
        const tilesX = Math.ceil(canvasSize.width / tileSize);
        const tilesY = Math.ceil(canvasSize.height / tileSize);
        const halfTilesX = Math.floor(tilesX / 2);
        const halfTilesY = Math.floor(tilesY / 2);

        // Calculate camera position
        let cameraTileX = worldPosition.x - halfTilesX;
        let cameraTileY = worldPosition.y - halfTilesY;
        cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
        cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

        // Check if position is within visible bounds
        if (screenTileX >= 0 && screenTileX < tilesX && screenTileY >= 0 && screenTileY < tilesY) {
            // Convert screen coordinates to world coordinates
            const worldX = Math.floor(cameraTileX + screenTileX);
            const worldY = Math.floor(cameraTileY + screenTileY);

            return { worldX, worldY };
        }

        return null;
    };

    // Handle painting at specific coordinates
    const paintTileAt = (worldX: number, worldY: number) => {
        if (!onTileClick) return;

        // Avoid painting the same tile twice in a row during drag
        if (lastPaintedTile && lastPaintedTile.x === worldX && lastPaintedTile.y === worldY) {
            return;
        }

        setLastPaintedTile({ x: worldX, y: worldY });
        onTileClick(worldX, worldY);
    };

    // Handle mouse down - start painting
    const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        // Paint mode behavior: only paint if explicitly in paint mode
        if (buildMode === 'paint') {
            const coords = getWorldCoordinatesFromEvent(event);
            if (coords) {
                setIsPainting(true);
                paintTileAt(coords.worldX, coords.worldY);
            }
        }
    };

    // Handle mouse move - continue painting if dragging
    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (buildMode !== 'paint' || !isPainting) return;

        const coords = getWorldCoordinatesFromEvent(event);
        if (coords) {
            paintTileAt(coords.worldX, coords.worldY);
        }
    };

    // Handle mouse up - stop painting
    const handleMouseUp = () => {
        setIsPainting(false);
        setLastPaintedTile(null);
    };

    // Handle mouse leave - stop painting when leaving canvas
    const handleMouseLeave = () => {
        setIsPainting(false);
        setLastPaintedTile(null);
    };

    // Handle touch start - for mobile touch painting
    const handleTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (event.touches.length === 0) return;

        const touch = event.touches[0];

        // Paint mode behavior: only paint if explicitly in paint mode
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

            // Calculate visible tiles
            const tilesX = Math.ceil(canvasSize.width / tileSize);
            const tilesY = Math.ceil(canvasSize.height / tileSize);
            const halfTilesX = Math.floor(tilesX / 2);
            const halfTilesY = Math.floor(tilesY / 2);

            // Calculate camera position
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

    // Handle touch move - for mobile touch painting
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

        // Calculate visible tiles
        const tilesX = Math.ceil(canvasSize.width / tileSize);
        const tilesY = Math.ceil(canvasSize.height / tileSize);
        const halfTilesX = Math.floor(tilesX / 2);
        const halfTilesY = Math.floor(tilesY / 2);

        // Calculate camera position
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

    // Handle touch end - stop painting
    const handleTouchEnd = () => {
        setIsPainting(false);
        setLastPaintedTile(null);
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw background color
        ctx.fillStyle = '#f0f8ff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Calculate visible tiles based on canvas size
        const tilesX = Math.ceil(canvasSize.width / tileSize);
        const tilesY = Math.ceil(canvasSize.height / tileSize);
        const halfTilesX = Math.floor(tilesX / 2);
        const halfTilesY = Math.floor(tilesY / 2);

        // Map boundaries (4200x4200 pixels at 40px per tile = 105 tiles)
        const MAP_SIZE_PIXELS = 4200;
        const ORIGINAL_TILE_SIZE = TILE_SIZE;

        // Calculate camera position in world coordinates (tiles)
        // Player is at worldPosition, we want to center the view on the player
        let cameraTileX = worldPosition.x - halfTilesX;
        let cameraTileY = worldPosition.y - halfTilesY;

        // Clamp camera to map boundaries
        cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
        cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

        // Convert camera tile position to pixel position in the original image
        const sourceX = cameraTileX * ORIGINAL_TILE_SIZE;
        const sourceY = cameraTileY * ORIGINAL_TILE_SIZE;

        // Draw layer 0 background image if available
        if (backgroundImage) {
            // Source dimensions from original image
            const sourceWidth = tilesX * ORIGINAL_TILE_SIZE;
            const sourceHeight = tilesY * ORIGINAL_TILE_SIZE;

            ctx.drawImage(
                backgroundImage,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                0,
                0,
                canvas.width,
                canvas.height
            );
        }

        // Draw layer 1 image overlay if available and visible
        if (layer1Image && layerVisibility[1]) {
            // Source dimensions from original image
            const sourceWidth = tilesX * ORIGINAL_TILE_SIZE;
            const sourceHeight = tilesY * ORIGINAL_TILE_SIZE;

            ctx.drawImage(layer1Image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        }

        // Draw base tiles if no background image
        if (!backgroundImage) {
            // Draw base tiles
            for (let y = 0; y < tilesY; y++) {
                for (let x = 0; x < tilesX; x++) {
                    const worldTileX = Math.floor(cameraTileX + x);
                    const worldTileY = Math.floor(cameraTileY + y);

                    // Get tile type from mapData if within bounds
                    let tileType = 0;
                    if (mapData[worldTileY] && mapData[worldTileY][worldTileX] !== undefined) {
                        tileType = mapData[worldTileY][worldTileX];
                    } else {
                        tileType = 0; // Default to grass
                    }

                    // Render void tiles as light background
                    if (tileType === -1) {
                        ctx.fillStyle = '#f0f8ff'; // Same as background
                        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
                        continue;
                    }

                    // Set tile color based on type
                    switch (tileType) {
                        case 0:
                            ctx.fillStyle = '#90EE90'; // Light green for grass
                            break;
                        case 1:
                            ctx.fillStyle = '#8B4513'; // Brown for dirt
                            break;
                        case 2:
                            ctx.fillStyle = '#4169E1'; // Blue for water
                            break;
                        case 3:
                            ctx.fillStyle = '#696969'; // Gray for stone
                            break;
                        default:
                            ctx.fillStyle = '#FFFFFF'; // White for unknown
                    }

                    ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
                }
            }
        }

        // Draw custom tile layers
        if (isLayeredTiles(customTiles)) {
            // Draw each layer in order
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
                            const customTileImage = layer[tileKey];

                            if (customTileImage && loadedImages[customTileImage]) {
                                const img = loadedImages[customTileImage];
                                ctx.drawImage(img, x * tileSize, y * tileSize, tileSize, tileSize);
                            }
                        }
                    }
                }
            });
        } else {
            // Legacy single layer rendering
            for (let y = 0; y < tilesY; y++) {
                for (let x = 0; x < tilesX; x++) {
                    const worldTileX = Math.floor(cameraTileX + x);
                    const worldTileY = Math.floor(cameraTileY + y);
                    const tileKey = `${worldTileX},${worldTileY}`;
                    const customTileImage = customTiles[tileKey];

                    if (customTileImage && loadedImages[customTileImage]) {
                        const img = loadedImages[customTileImage];
                        ctx.drawImage(img, x * tileSize, y * tileSize, tileSize, tileSize);
                    }
                }
            }
        }

        // Draw collision map overlay (red tiles for blocked areas) - only if enabled
        if (showCollisionMap) {
            // Calculate actual screen tile size to match background image rendering
            const screenTileWidth = canvas.width / tilesX;
            const screenTileHeight = canvas.height / tilesY;

            for (let y = 0; y < tilesY; y++) {
                for (let x = 0; x < tilesX; x++) {
                    const worldTileX = Math.floor(cameraTileX + x);
                    const worldTileY = Math.floor(cameraTileY + y);

                    // Check if player is at this position
                    const hasPlayer = worldTileX === worldPosition.x && worldTileY === worldPosition.y;

                    // Check if any agent is at this position
                    const agentAtPosition = agents.find((agent) => agent.x === worldTileX && agent.y === worldTileY);

                    if (hasPlayer) {
                        // Black for player tile
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; // Black with 50% opacity
                        ctx.fillRect(x * screenTileWidth, y * screenTileHeight, screenTileWidth, screenTileHeight);
                    } else if (agentAtPosition) {
                        // Use agent's unique color
                        const agentColor = agentAtPosition.color;
                        // Convert hex to rgba with 50% opacity
                        const r = parseInt(agentColor.slice(1, 3), 16);
                        const g = parseInt(agentColor.slice(3, 5), 16);
                        const b = parseInt(agentColor.slice(5, 7), 16);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
                        ctx.fillRect(x * screenTileWidth, y * screenTileHeight, screenTileWidth, screenTileHeight);
                    } else {
                        // Check collision map for blocked tiles
                        const tileKey = `${worldTileX},${worldTileY}`;
                        if (collisionMap[tileKey]) {
                            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; // Red with 50% opacity
                            ctx.fillRect(x * screenTileWidth, y * screenTileHeight, screenTileWidth, screenTileHeight);
                        }
                    }
                }
            }

            // Draw tile grid (outline for all tiles)
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)'; // Black with 30% opacity
            ctx.lineWidth = 1;
            for (let y = 0; y <= tilesY; y++) {
                ctx.beginPath();
                ctx.moveTo(0, y * screenTileHeight);
                ctx.lineTo(canvas.width, y * screenTileHeight);
                ctx.stroke();
            }
            for (let x = 0; x <= tilesX; x++) {
                ctx.beginPath();
                ctx.moveTo(x * screenTileWidth, 0);
                ctx.lineTo(x * screenTileWidth, canvas.height);
                ctx.stroke();
            }
        }

        // Agents and player are now rendered as DOM elements using SpriteAnimator
        // Canvas only renders background, tiles, and layers
    }, [
        mapData,
        tileSize,
        worldPosition.x,
        worldPosition.y,
        customTiles,
        loadedImages,
        layerVisibility,
        backgroundImage,
        layer1Image,
        canvasSize,
        collisionMap,
        showCollisionMap
    ]);

    // Calculate camera position for sprite positioning
    const tilesX = Math.ceil(canvasSize.width / tileSize);
    const tilesY = Math.ceil(canvasSize.height / tileSize);
    const halfTilesX = Math.floor(tilesX / 2);
    const halfTilesY = Math.floor(tilesY / 2);

    let cameraTileX = worldPosition.x - halfTilesX;
    let cameraTileY = worldPosition.y - halfTilesY;
    cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
    cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

    // Helper function to get startFrame based on direction
    const getStartFrame = (direction: 'up' | 'down' | 'left' | 'right') => {
        const directionMap = {
            down: 0,
            left: 3,
            up: 6,
            right: 9
        };
        return directionMap[direction];
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
            />

            {/* Render Agents using SpriteAnimator */}
            {agents.map((agent) => {
                let agentScreenX: number;
                let agentScreenY: number;

                if (agent.x !== undefined && agent.y !== undefined) {
                    agentScreenX = agent.x - cameraTileX;
                    agentScreenY = agent.y - cameraTileY;
                } else {
                    agentScreenX = agent.screenX;
                    agentScreenY = agent.screenY;
                }

                // Only render if agent is within visible area
                if (agentScreenX < -1 || agentScreenX > tilesX || agentScreenY < -1 || agentScreenY > tilesY) {
                    return null;
                }

                const agentIsMoving = agent.isMoving || false;
                const agentDirection = agent.direction || 'down';
                const agentStartFrame = getStartFrame(agentDirection);
                const agentSpriteUrl = agent.spriteUrl || '/sprite/sprite_kkaebi.png';
                const agentSpriteHeight = agent.spriteHeight || TILE_SIZE;
                const agentSpriteWidth = agent.spriteWidth || TILE_SIZE;

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
                            pointerEvents: 'none'
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
                        {/* Show agent coordinates when grid is visible */}
                        {showCollisionMap && agent.x !== undefined && agent.y !== undefined && (
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: '-18px',
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
                                ({agent.x}, {agent.y})
                            </div>
                        )}
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
                            top: `${playerScreenTileY * tileSize - TILE_SIZE / 4}px`,
                            width: `${tileSize}px`,
                            height: `${tileSize}px`,
                            pointerEvents: 'none',
                            zIndex: 10
                        }}
                    >
                        <SpriteAnimator
                            key={`player-${playerDirection}`}
                            sprite="/sprite/sprite_kkaebi.png"
                            width={TILE_SIZE}
                            height={TILE_SIZE}
                            scale={1}
                            fps={6}
                            frameCount={playerStartFrame + 3}
                            direction={'horizontal'}
                            shouldAnimate={playerIsMoving}
                            startFrame={playerStartFrame}
                        />
                        {/* Show player coordinates when grid is visible */}
                        {showCollisionMap && (
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
        </div>
    );
}
