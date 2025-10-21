'use client';

import { useEffect } from 'react';

interface Agent {
    id: string;
    x?: number;
    y?: number;
    color: string;
}

interface CollisionMapOverlayProps {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    showCollisionMap: boolean;
    collisionMap: { [key: string]: boolean };
    agents: Agent[];
    worldPosition: { x: number; y: number };
    cameraTileX: number;
    cameraTileY: number;
    tilesX: number;
    tilesY: number;
    canvasWidth: number;
    canvasHeight: number;
}

export default function CollisionMapOverlay({
    canvasRef,
    showCollisionMap,
    collisionMap,
    agents,
    worldPosition,
    cameraTileX,
    cameraTileY,
    tilesX,
    tilesY,
    canvasWidth,
    canvasHeight
}: CollisionMapOverlayProps) {
    useEffect(() => {
        if (!showCollisionMap) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate actual screen tile size to match background image rendering
        const screenTileWidth = canvasWidth / tilesX;
        const screenTileHeight = canvasHeight / tilesY;

        // Draw collision map tiles
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
            ctx.lineTo(canvasWidth, y * screenTileHeight);
            ctx.stroke();
        }
        for (let x = 0; x <= tilesX; x++) {
            ctx.beginPath();
            ctx.moveTo(x * screenTileWidth, 0);
            ctx.lineTo(x * screenTileWidth, canvasHeight);
            ctx.stroke();
        }
    }, [
        showCollisionMap,
        collisionMap,
        agents,
        worldPosition,
        cameraTileX,
        cameraTileY,
        tilesX,
        tilesY,
        canvasWidth,
        canvasHeight,
        canvasRef
    ]);

    return null;
}
