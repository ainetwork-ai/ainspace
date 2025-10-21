"use client";

import { useState, useEffect, useCallback } from "react";
import { useMapData } from "@/providers/MapDataProvider";
import { Agent } from "@/lib/world";
import { useLayer1Collision } from "@/hooks/useLayer1Collision";

export interface AgentInternal extends Agent {
  direction: "up" | "down" | "left" | "right";
  lastMoved: number;
  moveInterval: number;
  isMoving?: boolean;
}

interface UseAgentsProps {
  playerWorldPosition: { x: number; y: number };
  viewRadius: number;
}

export function useAgents({ playerWorldPosition }: UseAgentsProps) {
  const { generateTileAt } = useMapData();
  const { isBlocked: isLayer1Blocked } = useLayer1Collision("/map/layer_1.png");

  const [agents, setAgents] = useState<AgentInternal[]>([
    {
      id: "agent-1",
      x: 50,
      y: 48,
      color: "#00FF00",
      name: "Explorer Bot",
      direction: "right",
      lastMoved: Date.now(),
      moveInterval: 800,
      behavior: "random",
    },
    {
      id: "agent-2",
      x: 50,
      y: 48,
      color: "#FF6600",
      name: "Patrol Bot",
      direction: "up",
      lastMoved: Date.now(),
      moveInterval: 1000,
      behavior: "patrol",
    },
    {
      id: "agent-3",
      x: 48,
      y: 48,
      color: "#9933FF",
      name: "Wanderer",
      direction: "left",
      lastMoved: Date.now(),
      moveInterval: 600,
      behavior: "explorer",
    },
  ]);

  const isWalkable = useCallback(
    (x: number, y: number, currentAgents: AgentInternal[], checkingAgentId?: string): boolean => {
      //
      const MAP_TILES = 105;

      if (x < 0 || x >= MAP_TILES || y < 0 || y >= MAP_TILES) {
        return false;
      }

      if (x === playerWorldPosition.x && y === playerWorldPosition.y) {
        return false;
      }

      const isOccupiedByAgent = currentAgents.some(
        (agent) => agent.id !== checkingAgentId && agent.x === x && agent.y === y
      );
      if (isOccupiedByAgent) {
        return false;
      }

      const tileType = generateTileAt(x, y);
      if (tileType === 3) return false;
      if (isLayer1Blocked(x, y)) return false;
      return true;
    },
    [generateTileAt, isLayer1Blocked, playerWorldPosition]
  );

  const getRandomDirection = (): "up" | "down" | "left" | "right" => {
    const directions = ["up", "down", "left", "right"] as const;
    return directions[Math.floor(Math.random() * directions.length)];
  };

  const moveInDirection = (
    x: number,
    y: number,
    direction: "up" | "down" | "left" | "right"
  ): { x: number; y: number } => {
    switch (direction) {
      case "up":
        return { x, y: y - 1 };
      case "down":
        return { x, y: y + 1 };
      case "left":
        return { x: x - 1, y };
      case "right":
        return { x: x + 1, y };
      default:
        return { x, y };
    }
  };

  const getAgentBehavior = useCallback(
    (
      agent: AgentInternal,
      currentAgents: AgentInternal[]
    ): { newX: number; newY: number; newDirection: "up" | "down" | "left" | "right" } => {
      const { x, y, direction, behavior, id } = agent;

      switch (behavior) {
        case "random": {
          const shouldChangeDirection = Math.random() < 0.3;
          const newDirection = shouldChangeDirection ? getRandomDirection() : direction;
          const newPos = moveInDirection(x, y, newDirection);

          if (isWalkable(newPos.x, newPos.y, currentAgents, id)) {
            return { newX: newPos.x, newY: newPos.y, newDirection };
          }

          const altDirection = getRandomDirection();
          const altPos = moveInDirection(x, y, altDirection);
          if (isWalkable(altPos.x, altPos.y, currentAgents, id)) {
            return { newX: altPos.x, newY: altPos.y, newDirection: altDirection };
          }

          return { newX: x, newY: y, newDirection: getRandomDirection() };
        }

        case "patrol": {
          const newPos = moveInDirection(x, y, direction);

          if (isWalkable(newPos.x, newPos.y, currentAgents, id)) {
            return { newX: newPos.x, newY: newPos.y, newDirection: direction };
          }

          const clockwiseDirections = {
            up: "right" as const,
            right: "down" as const,
            down: "left" as const,
            left: "up" as const,
          };
          const newDirection = clockwiseDirections[direction];
          const turnPos = moveInDirection(x, y, newDirection);

          if (isWalkable(turnPos.x, turnPos.y, currentAgents, id)) {
            return { newX: turnPos.x, newY: turnPos.y, newDirection };
          }

          return { newX: x, newY: y, newDirection };
        }

        case "explorer": {
          const playerDistance =
            Math.abs(x - playerWorldPosition.x) + Math.abs(y - playerWorldPosition.y);

          if (playerDistance < 3) {
            const awayFromPlayerDirections: ("up" | "down" | "left" | "right")[] = [];
            if (x < playerWorldPosition.x) awayFromPlayerDirections.push("left");
            if (x > playerWorldPosition.x) awayFromPlayerDirections.push("right");
            if (y < playerWorldPosition.y) awayFromPlayerDirections.push("up");
            if (y > playerWorldPosition.y) awayFromPlayerDirections.push("down");

            for (const dir of awayFromPlayerDirections) {
              const pos = moveInDirection(x, y, dir);
              if (isWalkable(pos.x, pos.y, currentAgents, id)) {
                return { newX: pos.x, newY: pos.y, newDirection: dir };
              }
            }
          }

          const newDirection = Math.random() < 0.7 ? direction : getRandomDirection();
          const newPos = moveInDirection(x, y, newDirection);

          if (isWalkable(newPos.x, newPos.y, currentAgents, id)) {
            return { newX: newPos.x, newY: newPos.y, newDirection };
          }

          return { newX: x, newY: y, newDirection: getRandomDirection() };
        }

        default:
          return { newX: x, newY: y, newDirection: direction };
      }
    },
    [isWalkable, playerWorldPosition]
  );

  const updateAgents = useCallback(() => {
    const currentTime = Date.now();

    setAgents((prevAgents) =>
      prevAgents.map((agent) => {
        // Check if agent is currently in animation state (within 800ms of last move)
        const isCurrentlyAnimating = currentTime - agent.lastMoved < 800;

        if (currentTime - agent.lastMoved < agent.moveInterval) {
          return {
            ...agent,
            isMoving: isCurrentlyAnimating,
          };
        }

        const { newX, newY, newDirection } = getAgentBehavior(agent, prevAgents);

        // Check if agent actually moved
        const didMove = newX !== agent.x || newY !== agent.y;

        return {
          ...agent,
          x: newX,
          y: newY,
          direction: newDirection,
          lastMoved: currentTime,
          isMoving: didMove,
        };
      })
    );
  }, [getAgentBehavior]);

  const getVisibleAgents = useCallback(() => {
    return agents.map((agent) => ({
      ...agent,
      x: agent.x,
      y: agent.y,
      screenX: 0,
      screenY: 0,
      direction: agent.direction,
      isMoving: agent.isMoving,
    }));
  }, [agents]);

  useEffect(() => {
    const interval = setInterval(updateAgents, 100);
    return () => clearInterval(interval);
  }, [updateAgents]);

  const getWorldAgents = useCallback((): Agent[] => {
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      color: agent.color,
      x: agent.x,
      y: agent.y,
      behavior: agent.behavior,
    }));
  }, [agents]);

  return {
    agents,
    worldAgents: getWorldAgents(),
    visibleAgents: getVisibleAgents(),
    updateAgents,
  };
}
