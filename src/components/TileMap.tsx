"use client";

import { useEffect, useRef, useState } from "react";

interface Agent {
  id: string;
  screenX: number;
  screenY: number;
  x?: number; // world position
  y?: number; // world position
  color: string;
  name: string;
  hasCharacterImage?: boolean;
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
  buildMode?: "view" | "paint";
  onTileClick?: (x: number, y: number) => void;
  onMobileMove?: (direction: "up" | "down" | "left" | "right") => void;
  backgroundImageSrc?: string;
  layer1ImageSrc?: string;
}

export default function TileMap({
  mapData,
  tileSize,
  playerPosition,
  worldPosition,
  agents = [],
  customTiles = {},
  layerVisibility = { 0: true, 1: true, 2: true },
  buildMode = "view",
  onTileClick,
  onMobileMove,
  backgroundImageSrc,
  layer1ImageSrc,
}: TileMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadedImages, setLoadedImages] = useState<{ [key: string]: HTMLImageElement }>({});
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [layer1Image, setLayer1Image] = useState<HTMLImageElement | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const [lastPaintedTile, setLastPaintedTile] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isHoldingDirection, setIsHoldingDirection] = useState<
    "up" | "down" | "left" | "right" | null
  >(null);
  const moveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

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
          height: rect.height,
        });
      }
    };

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);
    return () => window.removeEventListener("resize", updateCanvasSize);
  }, []);

  // Detect if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth <= 768;
      setIsMobile(isTouchDevice && isSmallScreen);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Check if customTiles is using layer structure
  const isLayeredTiles = (tiles: TileLayers | { [key: string]: string }): tiles is TileLayers => {
    return (
      tiles &&
      typeof tiles === "object" &&
      ("layer0" in tiles || "layer1" in tiles || "layer2" in tiles)
    );
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
            [imageUrl]: img,
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

    // Map boundaries
    const MAP_TILES = 105;

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

  // Detect which region of the map was clicked for mobile movement
  const detectMapRegion = (
    clientX: number,
    clientY: number
  ): "up" | "down" | "left" | "right" | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Get position relative to canvas, accounting for scaling
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    const width = canvas.width;
    const height = canvas.height;

    // Calculate relative positions
    const relX = canvasX / width;
    const relY = canvasY / height;

    // Determine which region was clicked based on distance from edges
    // Priority: check if closer to vertical edges or horizontal edges
    const distFromLeft = relX;
    const distFromRight = 1 - relX;
    const distFromTop = relY;
    const distFromBottom = 1 - relY;

    // Find minimum distance to any edge
    const minHorizontalDist = Math.min(distFromLeft, distFromRight);
    const minVerticalDist = Math.min(distFromTop, distFromBottom);

    // If click is closer to a horizontal edge than vertical edge
    if (minVerticalDist < minHorizontalDist) {
      return distFromTop < distFromBottom ? "up" : "down";
    } else {
      return distFromLeft < distFromRight ? "left" : "right";
    }
  };

  // Start continuous movement in a direction
  const startContinuousMove = (direction: "up" | "down" | "left" | "right") => {
    // Clear any existing interval
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
    }

    setIsHoldingDirection(direction);

    // Move immediately
    if (onMobileMove) {
      onMobileMove(direction);
    }

    // Start interval for continuous movement (200ms interval for smooth movement)
    moveIntervalRef.current = setInterval(() => {
      if (onMobileMove) {
        onMobileMove(direction);
      }
    }, 200);
  };

  // Stop continuous movement
  const stopContinuousMove = () => {
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
      moveIntervalRef.current = null;
    }
    setIsHoldingDirection(null);
  };

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (moveIntervalRef.current) {
        clearInterval(moveIntervalRef.current);
      }
    };
  }, []);

  // Handle mouse down - start painting or trigger mobile movement
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    // On mobile with onMobileMove handler and not in paint mode, detect region for movement
    if (isMobile && onMobileMove && buildMode !== "paint") {
      const region = detectMapRegion(event.clientX, event.clientY);
      if (region) {
        startContinuousMove(region);
        return;
      }
    }

    // Paint mode behavior: only paint if explicitly in paint mode
    if (buildMode === "paint") {
      const coords = getWorldCoordinatesFromEvent(event);
      if (coords) {
        setIsPainting(true);
        paintTileAt(coords.worldX, coords.worldY);
      }
    }
  };

  // Handle mouse move - continue painting if dragging
  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (buildMode !== "paint" || !isPainting) return;

    const coords = getWorldCoordinatesFromEvent(event);
    if (coords) {
      paintTileAt(coords.worldX, coords.worldY);
    }
  };

  // Handle mouse up - stop painting or continuous movement
  const handleMouseUp = () => {
    // Stop continuous movement if active
    if (isHoldingDirection) {
      stopContinuousMove();
    }

    setIsPainting(false);
    setLastPaintedTile(null);
  };

  // Handle mouse leave - stop painting and continuous movement when leaving canvas
  const handleMouseLeave = () => {
    // Stop continuous movement if active
    if (isHoldingDirection) {
      stopContinuousMove();
    }

    setIsPainting(false);
    setLastPaintedTile(null);
  };

  // Handle touch start - for mobile touch support
  const handleTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
    if (event.touches.length === 0) return;

    const touch = event.touches[0];

    // On mobile with onMobileMove handler and not in paint mode, detect region for movement
    if (isMobile && onMobileMove && buildMode !== "paint") {
      const region = detectMapRegion(touch.clientX, touch.clientY);
      if (region) {
        event.preventDefault(); // Prevent scrolling while holding
        startContinuousMove(region);
        return;
      }
    }

    // Paint mode behavior: only paint if explicitly in paint mode
    if (buildMode === "paint") {
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

      // Map boundaries
      const MAP_TILES = 105;

      // Calculate camera position
      let cameraTileX = worldPosition.x - halfTilesX;
      let cameraTileY = worldPosition.y - halfTilesY;
      cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
      cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

      if (
        screenTileX >= 0 &&
        screenTileX < tilesX &&
        screenTileY >= 0 &&
        screenTileY < tilesY
      ) {
        const worldX = Math.floor(cameraTileX + screenTileX);
        const worldY = Math.floor(cameraTileY + screenTileY);

        setIsPainting(true);
        paintTileAt(worldX, worldY);
      }
    }
  };

  // Handle touch move - for mobile touch painting
  const handleTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
    if (buildMode !== "paint" || !isPainting || event.touches.length === 0) return;

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

    // Map boundaries
    const MAP_TILES = 105;

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

  // Handle touch end - stop painting or continuous movement
  const handleTouchEnd = () => {
    // Stop continuous movement if active
    if (isHoldingDirection) {
      stopContinuousMove();
    }

    setIsPainting(false);
    setLastPaintedTile(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw background color
    ctx.fillStyle = "#f0f8ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate visible tiles based on canvas size
    const tilesX = Math.ceil(canvasSize.width / tileSize);
    const tilesY = Math.ceil(canvasSize.height / tileSize);
    const halfTilesX = Math.floor(tilesX / 2);
    const halfTilesY = Math.floor(tilesY / 2);

    // Map boundaries (4200x4200 pixels at 40px per tile = 105 tiles)
    const MAP_SIZE_PIXELS = 4200;
    const ORIGINAL_TILE_SIZE = 40;
    const MAP_TILES = MAP_SIZE_PIXELS / ORIGINAL_TILE_SIZE; // 105 tiles

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

      ctx.drawImage(
        layer1Image,
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
          ctx.fillStyle = "#f0f8ff"; // Same as background
          ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
          continue;
        }

        // Set tile color based on type
        switch (tileType) {
          case 0:
            ctx.fillStyle = "#90EE90"; // Light green for grass
            break;
          case 1:
            ctx.fillStyle = "#8B4513"; // Brown for dirt
            break;
          case 2:
            ctx.fillStyle = "#4169E1"; // Blue for water
            break;
          case 3:
            ctx.fillStyle = "#696969"; // Gray for stone
            break;
          default:
            ctx.fillStyle = "#FFFFFF"; // White for unknown
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

    // Draw agents
    agents.forEach((agent) => {
      // Calculate screen position based on world position if available
      let agentScreenX: number;
      let agentScreenY: number;

      if (agent.x !== undefined && agent.y !== undefined) {
        // Use world position and camera to calculate screen position
        agentScreenX = agent.x - cameraTileX;
        agentScreenY = agent.y - cameraTileY;
      } else {
        // Fallback to legacy screenX/screenY
        agentScreenX = agent.screenX;
        agentScreenY = agent.screenY;
      }

      // Only draw if agent is within visible area (with some buffer for partial visibility)
      if (agentScreenX < -1 || agentScreenX > tilesX || agentScreenY < -1 || agentScreenY > tilesY) {
        return;
      }

      ctx.fillStyle = agent.color;
      ctx.fillRect(
        agentScreenX * tileSize + 4,
        agentScreenY * tileSize + 4,
        tileSize - 8,
        tileSize - 8
      );

      // Draw agent border
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        agentScreenX * tileSize + 4,
        agentScreenY * tileSize + 4,
        tileSize - 8,
        tileSize - 8
      );
    });

    // Draw player (on top of agents) - ALWAYS at screen center
    // Calculate player screen position based on their world position and camera
    const playerScreenTileX = worldPosition.x - cameraTileX;
    const playerScreenTileY = worldPosition.y - cameraTileY;

    ctx.fillStyle = "#FF0000"; // Red for player
    ctx.fillRect(
      playerScreenTileX * tileSize + 4,
      playerScreenTileY * tileSize + 4,
      tileSize - 8,
      tileSize - 8
    );

    // Draw player border
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      playerScreenTileX * tileSize + 4,
      playerScreenTileY * tileSize + 4,
      tileSize - 8,
      tileSize - 8
    );
  }, [
    mapData,
    tileSize,
    playerPosition,
    worldPosition.x,
    worldPosition.y,
    agents,
    customTiles,
    loadedImages,
    layerVisibility,
    backgroundImage,
    layer1Image,
    canvasSize,
  ]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="w-full h-full"
        style={{
          background: "#f0f8ff",
          cursor: buildMode === "paint" ? "crosshair" : "default",
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
          touchAction: "none",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  );
}
