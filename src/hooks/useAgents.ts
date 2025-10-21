'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { Agent } from '@/lib/world';
import { useLayer1Collision } from '@/hooks/useLayer1Collision';

export interface AgentInternal extends Agent {
  direction: 'up' | 'down' | 'left' | 'right';
  lastMoved: number;
  moveInterval: number;
}

interface UseAgentsProps {
  playerWorldPosition: { x: number; y: number };
  mapWidth: number;
  mapHeight: number;
  viewRadius: number;
}

export function useAgents({ playerWorldPosition, mapWidth, mapHeight }: UseAgentsProps) {
  const { generateTileAt } = useMapData();
  const { isBlocked: isLayer1Blocked } = useLayer1Collision('/map/layer_1.png');

  const [agents, setAgents] = useState<AgentInternal[]>([
    {
      id: 'agent-1',
      x: 5,
      y: 3,
      color: '#00FF00',
      name: 'Explorer Bot',
      direction: 'right',
      lastMoved: Date.now(),
      moveInterval: 1500,
      behavior: 'random'
    },
    {
      id: 'agent-2', 
      x: -3,
      y: -2,
      color: '#FF6600',
      name: 'Patrol Bot',
      direction: 'up',
      lastMoved: Date.now(),
      moveInterval: 2000,
      behavior: 'patrol'
    },
    {
      id: 'agent-3',
      x: 8,
      y: -5,
      color: '#9933FF',
      name: 'Wanderer',
      direction: 'left',
      lastMoved: Date.now(),
      moveInterval: 1000,
      behavior: 'explorer'
    }
  ]);

  const isWalkable = useCallback((x: number, y: number): boolean => {
    const tileType = generateTileAt(x, y);
    if (tileType === 3) return false; // Stone/wall
    if (isLayer1Blocked(x, y)) return false; // Layer1 obstacle
    return true;
  }, [generateTileAt, isLayer1Blocked]);

  const getRandomDirection = (): 'up' | 'down' | 'left' | 'right' => {
    const directions = ['up', 'down', 'left', 'right'] as const;
    return directions[Math.floor(Math.random() * directions.length)];
  };

  const moveInDirection = (x: number, y: number, direction: 'up' | 'down' | 'left' | 'right'): { x: number; y: number } => {
    switch (direction) {
      case 'up': return { x, y: y - 1 };
      case 'down': return { x, y: y + 1 };
      case 'left': return { x: x - 1, y };
      case 'right': return { x: x + 1, y };
      default: return { x, y };
    }
  };

  const getAgentBehavior = useCallback((agent: AgentInternal): { newX: number; newY: number; newDirection: 'up' | 'down' | 'left' | 'right' } => {
    const { x, y, direction, behavior } = agent;

    switch (behavior) {
      case 'random': {
        // Random movement with some persistence
        const shouldChangeDirection = Math.random() < 0.3;
        const newDirection = shouldChangeDirection ? getRandomDirection() : direction;
        const newPos = moveInDirection(x, y, newDirection);
        
        if (isWalkable(newPos.x, newPos.y)) {
          return { newX: newPos.x, newY: newPos.y, newDirection };
        }
        
        // If blocked, try a different direction
        const altDirection = getRandomDirection();
        const altPos = moveInDirection(x, y, altDirection);
        if (isWalkable(altPos.x, altPos.y)) {
          return { newX: altPos.x, newY: altPos.y, newDirection: altDirection };
        }
        
        return { newX: x, newY: y, newDirection: getRandomDirection() };
      }

      case 'patrol': {
        // Try to move in current direction, turn when blocked
        const newPos = moveInDirection(x, y, direction);
        
        if (isWalkable(newPos.x, newPos.y)) {
          return { newX: newPos.x, newY: newPos.y, newDirection: direction };
        }
        
        // Turn clockwise when blocked
        const clockwiseDirections = {
          'up': 'right' as const,
          'right': 'down' as const,
          'down': 'left' as const,
          'left': 'up' as const
        };
        const newDirection = clockwiseDirections[direction];
        const turnPos = moveInDirection(x, y, newDirection);
        
        if (isWalkable(turnPos.x, turnPos.y)) {
          return { newX: turnPos.x, newY: turnPos.y, newDirection };
        }
        
        return { newX: x, newY: y, newDirection };
      }

      case 'explorer': {
        // Move towards unexplored areas (away from player)
        const playerDistance = Math.abs(x - playerWorldPosition.x) + Math.abs(y - playerWorldPosition.y);
        
        // If too close to player, move away
        if (playerDistance < 3) {
          const awayFromPlayerDirections: ('up' | 'down' | 'left' | 'right')[] = [];
          if (x < playerWorldPosition.x) awayFromPlayerDirections.push('left');
          if (x > playerWorldPosition.x) awayFromPlayerDirections.push('right');
          if (y < playerWorldPosition.y) awayFromPlayerDirections.push('up');
          if (y > playerWorldPosition.y) awayFromPlayerDirections.push('down');
          
          for (const dir of awayFromPlayerDirections) {
            const pos = moveInDirection(x, y, dir);
            if (isWalkable(pos.x, pos.y)) {
              return { newX: pos.x, newY: pos.y, newDirection: dir };
            }
          }
        }
        
        // Otherwise, random exploration
        const newDirection = Math.random() < 0.7 ? direction : getRandomDirection();
        const newPos = moveInDirection(x, y, newDirection);
        
        if (isWalkable(newPos.x, newPos.y)) {
          return { newX: newPos.x, newY: newPos.y, newDirection };
        }
        
        return { newX: x, newY: y, newDirection: getRandomDirection() };
      }

      default:
        return { newX: x, newY: y, newDirection: direction };
    }
  }, [isWalkable, playerWorldPosition]);

  const updateAgents = useCallback(() => {
    const currentTime = Date.now();
    
    setAgents(prevAgents => 
      prevAgents.map(agent => {
        if (currentTime - agent.lastMoved < agent.moveInterval) {
          return agent;
        }

        const { newX, newY, newDirection } = getAgentBehavior(agent);
        
        return {
          ...agent,
          x: newX,
          y: newY,
          direction: newDirection,
          lastMoved: currentTime
        };
      })
    );
  }, [getAgentBehavior]);

  // Get visible agents (within the square view bounds)
  const getVisibleAgents = useCallback(() => {
    const halfWidth = Math.floor(mapWidth / 2);
    const halfHeight = Math.floor(mapHeight / 2);
    
    const minX = playerWorldPosition.x - halfWidth;
    const maxX = playerWorldPosition.x + halfWidth;
    const minY = playerWorldPosition.y - halfHeight;
    const maxY = playerWorldPosition.y + halfHeight;

    return agents
      .filter(agent => {
        // Check if agent is within square view bounds
        return agent.x >= minX && agent.x <= maxX && 
               agent.y >= minY && agent.y <= maxY;
      })
      .map(agent => ({
        ...agent,
        screenX: agent.x - minX,
        screenY: agent.y - minY
      }));
  }, [agents, playerWorldPosition, mapWidth, mapHeight]);

  useEffect(() => {
    const interval = setInterval(updateAgents, 100);
    return () => clearInterval(interval);
  }, [updateAgents]);

  // Convert internal agents to world-compatible agents
  const getWorldAgents = useCallback((): Agent[] => {
    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      color: agent.color,
      x: agent.x,
      y: agent.y,
      behavior: agent.behavior
    }));
  }, [agents]);

  return {
    agents,
    worldAgents: getWorldAgents(),
    visibleAgents: getVisibleAgents(),
    updateAgents
  };
}