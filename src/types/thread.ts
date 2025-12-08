export interface Thread {
    id: string;
    threadName: string;
    agentNames: string[];
    agentComboId: string; // sha-256 hash for agent combination lookup
    createdAt: string;
    lastMessageAt: string;
}
