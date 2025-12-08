/**
 * Generate SHA-256 hash for agent combination
 * Automatically detects environment (browser vs Node.js) and uses appropriate API
 */
export async function generateAgentComboId(agentNames: string[]): Promise<string> {
    const sorted = [...agentNames]
        .map(n => n.trim().toLowerCase())
        .sort();
    const combined = sorted.join('|');

    // Check if running in browser or Node.js
    if (typeof window !== 'undefined') {
        // Browser: Use Web Crypto API
        const encoder = new TextEncoder();
        const data = encoder.encode(combined);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return hashHex;
    } else {
        // Node.js: Use crypto module
        const crypto = await import('crypto');
        return crypto.createHash('sha256')
            .update(combined, 'utf-8')
            .digest('hex');
    }
}
