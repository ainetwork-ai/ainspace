/**
 * Initialize default A2A agents on app startup
 */

export interface DefaultAgent {
  a2aUrl: string;
  x: number;
  y: number;
  color: string;
  spriteUrl: string;
  spriteHeight: number;
  spriteWidth: number;
  behavior: 'random' | 'patrol' | 'explorer';
  moveInterval: number;
}

// Default agents with their A2A URLs and visual properties
export const DEFAULT_AGENTS: DefaultAgent[] = [
  {
    a2aUrl: 'https://a2a-builder.ainetwork.ai/api/agents/ryu-seong-ryong-1761332069636/.well-known/agent.json',
    x: 59,
    y: 68,
    color: '#00FF00',
    spriteUrl: '/sprite/sprite_sungryong.png',
    spriteHeight: 86,
    spriteWidth: 32,
    behavior: 'random',
    moveInterval: 800,
  },
  {
    a2aUrl: 'https://a2a-builder.ainetwork.ai/api/agents/ryu-unryong-1761332143861/.well-known/agent.json',
    x: 61,
    y: 70,
    color: '#FF6600',
    spriteUrl: '/sprite/sprite_unryong.png',
    spriteHeight: 86,
    spriteWidth: 32,
    behavior: 'patrol',
    moveInterval: 1000,
  },
  {
    a2aUrl: 'https://a2a-builder.ainetwork.ai/api/agents/horang-1761344578687/.well-known/agent.json',
    x: 57,
    y: 70,
    color: '#9933FF',
    spriteUrl: '/sprite/sprite_horaeng.png',
    spriteHeight: 32,
    spriteWidth: 32,
    behavior: 'explorer',
    moveInterval: 600,
  },
  {
    a2aUrl: 'https://a2a-builder.ainetwork.ai/api/agents/kkaebi-1761332302116/.well-known/agent.json',
    x: 58,
    y: 72,
    color: '#0000FF',
    spriteUrl: '/sprite/sprite_kkaebi.png',
    spriteHeight: 32,
    spriteWidth: 32,
    behavior: 'explorer',
    moveInterval: 600,
  },
];

/**
 * Register a single agent with the backend
 * Uses the agent-proxy endpoint to avoid CORS issues
 */
async function registerAgent(agent: DefaultAgent): Promise<boolean> {
  try {
    // Use agent-proxy to validate and get agent card
    const proxyResponse = await fetch('/api/agent-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentUrl: agent.a2aUrl,
      }),
    });

    if (!proxyResponse.ok) {
      console.error(`✗ Failed to validate agent card from ${agent.a2aUrl}`);
      return false;
    }

    const { agentCard } = await proxyResponse.json();

    // Register with backend including visual properties
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentUrl: agent.a2aUrl,
        agentCard: {
          ...agentCard,
          // Add visual properties
          x: agent.x,
          y: agent.y,
          color: agent.color,
          spriteUrl: agent.spriteUrl,
          spriteHeight: agent.spriteHeight,
          spriteWidth: agent.spriteWidth,
          behavior: agent.behavior,
          moveInterval: agent.moveInterval,
        },
      }),
    });

    if (response.ok) {
      console.log(`✓ Registered agent: ${agentCard.name}`);
      return true;
    } else if (response.status === 409) {
      // Agent already exists
      console.log(`→ Agent already exists: ${agentCard.name}`);
      return true;
    } else {
      console.error(`✗ Failed to register agent: ${agentCard.name}`, await response.text());
      return false;
    }
  } catch (error) {
    console.error(`✗ Error registering agent from ${agent.a2aUrl}:`, error);
    return false;
  }
}

/**
 * Initialize all default agents
 * Call this on app startup (e.g., in a provider or layout component)
 */
export async function initializeDefaultAgents(): Promise<void> {
  console.log('🚀 Initializing default A2A agents...');

  const results = await Promise.allSettled(
    DEFAULT_AGENTS.map((agent) => registerAgent(agent))
  );

  const successful = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  const failed = results.length - successful;

  console.log(`✓ Agent initialization complete: ${successful} successful, ${failed} failed`);
}
