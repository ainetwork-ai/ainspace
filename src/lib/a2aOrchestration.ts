/**
 * A2A Orchestration API Client
 * Handles thread management, agent imports, and real-time messaging
 */

const A2A_ORCHESTRATION_BASE_URL = 'https://a2a-orchestration.ainetwork.ai/api';

export interface Agent {
  name: string;
  role: string;
  a2aUrl: string;
  color: string;
}

export interface Thread {
  id: string;
  createdAt: string;
  agents?: Agent[];
}

export interface Message {
  id: string;
  threadId: string;
  sender: string;
  content: string;
  timestamp: string;
}

export interface StreamEvent {
  type: 'connected' | 'message' | 'block' | 'error';
  data: {
    // Nested message data structure from A2A Orchestration
    data?: {
      id?: string;
      speaker?: string;
      content?: string;
      timestamp?: number;
      replyTo?: string;
      status?: 'accepted' | 'dropped';
    };
    // Direct fields (fallback)
    content?: string;
    message?: string;
    sender?: string;
    agentName?: string;
    speaker?: string;
    summary?: string;
    error?: string;
    clientId?: string;
    [key: string]: unknown;
  };
}

/**
 * Create a new thread
 * @param name - Thread name (required)
 * @returns Thread object with ID
 */
export async function createThread(name: string = 'Chat Thread'): Promise<Thread> {
  const response = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/threads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create thread: ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  if (!result.success || !result.thread) {
    throw new Error('Invalid thread creation response');
  }

  return result.thread;
}

/**
 * Import an agent from A2A URL
 * @param a2aUrl - The agent's A2A card URL
 * @returns Agent information
 */
export async function importAgent(a2aUrl: string): Promise<Agent> {
  const response = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/agents/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ a2aUrl }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to import agent: ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  if (!result.success || !result.agent) {
    throw new Error('Invalid agent import response');
  }

  return result.agent;
}

/**
 * Add an agent to a thread
 * @param threadId - The thread ID
 * @param agent - Agent information
 */
export async function addAgentToThread(threadId: string, agent: Agent): Promise<void> {
  const response = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/threads/${threadId}/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(agent),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to add agent to thread: ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error('Failed to add agent to thread');
  }
}

/**
 * Send a message to a thread
 * All agents in the thread will respond in parallel
 * @param threadId - The thread ID
 * @param message - The message content
 * @returns Message ID
 */
export async function sendMessage(threadId: string, message: string): Promise<string> {
  const response = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send message: ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  if (!result.success || !result.messageId) {
    throw new Error('Invalid message send response');
  }

  return result.messageId;
}

/**
 * Get all threads
 * @returns Array of threads
 */
export async function getAllThreads(): Promise<Thread[]> {
  const response = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/threads`);

  if (!response.ok) {
    throw new Error(`Failed to get threads: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get a specific thread
 * @param threadId - The thread ID
 * @returns Thread information
 */
export async function getThread(threadId: string): Promise<Thread> {
  const response = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/threads/${threadId}`);

  if (!response.ok) {
    throw new Error(`Failed to get thread: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete a thread
 * @param threadId - The thread ID
 */
export async function deleteThread(threadId: string): Promise<void> {
  const response = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/threads/${threadId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete thread: ${response.statusText}`);
  }
}

/**
 * Remove an agent from a thread
 * @param threadId - The thread ID
 * @param agentName - The agent name
 */
export async function removeAgentFromThread(threadId: string, agentName: string): Promise<void> {
  const response = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/threads/${threadId}/agents/${agentName}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to remove agent from thread: ${response.statusText}`);
  }
}

/**
 * Connect to a thread's real-time stream using SSE via our proxy
 * @param threadId - The thread ID
 * @param onMessage - Callback for incoming events
 * @returns EventSource instance (call .close() to disconnect)
 */
export function connectToThreadStream(
  threadId: string,
  onMessage: (event: StreamEvent) => void
): EventSource {
  // Use our proxy API to avoid CORS issues
  const eventSource = new EventSource(`/api/thread-stream/${threadId}`);

  eventSource.onmessage = (event) => {
    try {
      console.log('Raw SSE event.data:', event.data);
      const data = JSON.parse(event.data);
      console.log('Parsed SSE data:', data);
      onMessage(data);
    } catch (error) {
      console.error('Failed to parse SSE message:', error, 'Raw data:', event.data);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE connection error:', error);
    onMessage({
      type: 'error',
      data: { error: 'Connection error' },
    });
  };

  return eventSource;
}
