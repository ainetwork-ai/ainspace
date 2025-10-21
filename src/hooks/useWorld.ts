import { useCallback, useEffect, useRef } from 'react';
import { World, Agent, Player, AgentResponse } from '@/lib/world';

interface UseWorldProps {
  agents: Agent[];
  playerPosition: Player;
  onAgentResponse?: (response: AgentResponse & { threadId?: string }) => void;
}

export function useWorld({ agents, playerPosition, onAgentResponse }: UseWorldProps) {
  const worldRef = useRef<World | null>(null);

  // Initialize or update world instance
  useEffect(() => {
    if (!worldRef.current) {
      worldRef.current = new World(agents, playerPosition);
    } else {
      worldRef.current.updateAgents(agents);
      worldRef.current.updatePlayer(playerPosition);
    }
  }, [agents, playerPosition]);

  // Send message through the world system
  const sendMessage = useCallback(async (content: string, threadId?: string, broadcastRadius?: number) => {
    if (!worldRef.current) return;

    const responses = await worldRef.current.processMessage(content, broadcastRadius, threadId);
    
    // Schedule each response based on its delay
    responses.forEach((response) => {
      setTimeout(() => {
        onAgentResponse?.({...response, threadId});
      }, response.delay);
    });

    return responses;
  }, [onAgentResponse]);

  // Get agent suggestions for autocomplete
  const getAgentSuggestions = useCallback((partialName: string) => {
    if (!worldRef.current) return [];
    return worldRef.current.getAgentSuggestions(partialName);
  }, []);

  // Get all agents
  const getAllAgents = useCallback(() => {
    if (!worldRef.current) return [];
    return worldRef.current.getAllAgents();
  }, []);

  // Get agents within a certain range
  const getAgentsInRange = useCallback((radius?: number) => {
    if (!worldRef.current) return [];
    return worldRef.current.getAgentsInRange(radius);
  }, []);

  return {
    sendMessage,
    getAgentSuggestions,
    getAllAgents,
    getAgentsInRange
  };
}