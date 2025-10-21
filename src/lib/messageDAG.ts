export interface MessageNode {
  id: string;
  content: string;
  sender: 'player' | 'agent';
  agentId?: string; // Only for agent messages
  agentName?: string; // Only for agent messages
  timestamp: Date;
  parentIds: string[]; // Messages this is responding to
  childIds: string[]; // Messages that respond to this
  depth: number; // Distance from root message (player message = 0)
  position?: { x: number; y: number }; // For visual positioning
}

export interface MessageDAG {
  nodes: Map<string, MessageNode>;
  roots: string[]; // Player messages (no parents)
  leaves: string[]; // Messages with no responses yet
}

export class MessageDAGManager {
  private dag: MessageDAG;

  constructor() {
    this.dag = {
      nodes: new Map(),
      roots: [],
      leaves: []
    };
  }

  // Add a player message (root node)
  addPlayerMessage(id: string, content: string): void {
    const node: MessageNode = {
      id,
      content,
      sender: 'player',
      timestamp: new Date(),
      parentIds: [],
      childIds: [],
      depth: 0,
      position: { x: 0, y: this.dag.roots.length }
    };

    this.dag.nodes.set(id, node);
    this.dag.roots.push(id);
    this.dag.leaves.push(id);
  }

  // Add agent responses to a message
  addAgentResponses(parentMessageId: string, responses: {
    id: string;
    content: string;
    agentId: string;
    agentName: string;
  }[]): void {
    const parentNode = this.dag.nodes.get(parentMessageId);
    if (!parentNode) {
      throw new Error(`Parent message ${parentMessageId} not found`);
    }

    // Remove parent from leaves if it wasn't already removed
    const leafIndex = this.dag.leaves.indexOf(parentMessageId);
    if (leafIndex > -1) {
      this.dag.leaves.splice(leafIndex, 1);
    }

    responses.forEach((response, index) => {
      const responseNode: MessageNode = {
        id: response.id,
        content: response.content,
        sender: 'agent',
        agentId: response.agentId,
        agentName: response.agentName,
        timestamp: new Date(),
        parentIds: [parentMessageId],
        childIds: [],
        depth: parentNode.depth + 1,
        position: { 
          x: parentNode.depth + 1, 
          y: (parentNode.position?.y || 0) + index - (responses.length - 1) / 2 
        }
      };

      // Add to DAG
      this.dag.nodes.set(response.id, responseNode);
      
      // Update parent's children
      parentNode.childIds.push(response.id);
      
      // Add to leaves
      this.dag.leaves.push(response.id);
    });
  }

  // Get message thread (path from root to leaf)
  getMessageThread(messageId: string): MessageNode[] {
    const node = this.dag.nodes.get(messageId);
    if (!node) return [];

    let current: MessageNode | undefined = node;

    // Trace back to root
    const pathToRoot: MessageNode[] = [];
    while (current) {
      pathToRoot.unshift(current);
      current = current.parentIds.length > 0 ?
        this.dag.nodes.get(current.parentIds[0]) : undefined;
    }

    return pathToRoot;
  }

  // Get all responses to a message
  getResponses(messageId: string): MessageNode[] {
    const node = this.dag.nodes.get(messageId);
    if (!node) return [];

    return node.childIds.map(childId => this.dag.nodes.get(childId)!).filter(Boolean);
  }

  // Get conversation tree for visualization
  getConversationTree(): {
    nodes: MessageNode[];
    edges: { from: string; to: string }[];
  } {
    const nodes = Array.from(this.dag.nodes.values());
    const edges: { from: string; to: string }[] = [];

    nodes.forEach(node => {
      node.childIds.forEach(childId => {
        edges.push({ from: node.id, to: childId });
      });
    });

    return { nodes, edges };
  }

  // Get latest messages in chronological order with DAG structure
  getLatestMessagesWithStructure(): MessageNode[] {
    // Return all messages in chronological order
    const allMessages = Array.from(this.dag.nodes.values());
    return allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // Get message by ID
  getMessage(id: string): MessageNode | undefined {
    return this.dag.nodes.get(id);
  }

  // Get conversation statistics
  getStats(): {
    totalMessages: number;
    playerMessages: number;
    agentMessages: number;
    activeThreads: number;
    maxDepth: number;
  } {
    const nodes = Array.from(this.dag.nodes.values());
    const playerMessages = nodes.filter(n => n.sender === 'player').length;
    const agentMessages = nodes.filter(n => n.sender === 'agent').length;
    const maxDepth = Math.max(...nodes.map(n => n.depth), 0);

    return {
      totalMessages: nodes.length,
      playerMessages,
      agentMessages,
      activeThreads: this.dag.roots.length,
      maxDepth
    };
  }

  // Clear all messages
  clear(): void {
    this.dag = {
      nodes: new Map(),
      roots: [],
      leaves: []
    };
  }

  // Export DAG structure for debugging
  exportDAG(): MessageDAG {
    return {
      nodes: new Map(this.dag.nodes),
      roots: [...this.dag.roots],
      leaves: [...this.dag.leaves]
    };
  }
}