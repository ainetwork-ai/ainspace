import { createClient } from 'redis';
import crypto from 'crypto';

function generateAgentComboId(agentNames: string[]): string {
    const sorted = [...agentNames]
        .map(n => n.trim().toLowerCase())
        .sort();
    const combined = sorted.join('|');
    return crypto.createHash('sha256')
        .update(combined, 'utf-8')
        .digest('hex');
}

async function migrate() {
    const redis = createClient({
        url: process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379'
    });

    console.log('Connecting to Redis...');
    await redis.connect();
    console.log('Connected to Redis');

    let cursor = 0;
    const userThreadKeys: string[] = [];

    // 1. Find all user:*:threads keys
    console.log('\n1. Scanning for user thread keys...');
    do {
        const result = await redis.scan(cursor, {
            MATCH: 'user:*:threads',
            COUNT: 100
        });
        cursor = result.cursor;
        userThreadKeys.push(...result.keys);
    } while (cursor !== 0);

    console.log(`Found ${userThreadKeys.length} user thread keys\n`);

    let totalThreads = 0;
    let migratedThreads = 0;
    let skippedThreads = 0;

    // 2. Migrate each user's threads
    for (const key of userThreadKeys) {
        const userId = key.split(':')[1];
        console.log(`\n--- Processing user: ${userId} ---`);

        const oldThreads = await redis.hGetAll(key);
        const threadCount = Object.keys(oldThreads).length;
        console.log(`  Found ${threadCount} threads`);

        for (const [oldKey, dataStr] of Object.entries(oldThreads)) {
            totalThreads++;
            try {
                const data = JSON.parse(dataStr);

                // Extract thread ID (backendThreadId or id)
                const threadId = data.backendThreadId || data.id;
                if (!threadId) {
                    console.warn(`  ⚠ No threadId found for key "${oldKey}", skipping`);
                    skippedThreads++;
                    continue;
                }

                // Calculate agentComboId
                const agentComboId = generateAgentComboId(data.agentNames || []);

                // Build Thread object
                const thread = {
                    threadName: data.threadName,
                    id: threadId,
                    agentNames: data.agentNames || [],
                    agentComboId,
                    createdAt: data.createdAt || new Date().toISOString(),
                    lastMessageAt: data.lastMessageAt || new Date().toISOString()
                };

                // Save in new structure
                await redis.hSet(`user:${userId}:threads`, {
                    [threadId]: JSON.stringify(thread)
                });

                // Save agent combo mapping
                await redis.hSet(`user:${userId}:agent_combos`, {
                    [agentComboId]: threadId
                });

                // Delete old key if different from new key
                if (oldKey !== threadId) {
                    await redis.hDel(key, oldKey);
                    console.log(`  ✓ Migrated: "${oldKey}" → "${threadId}"`);
                } else {
                    console.log(`  ✓ Updated: "${threadId}" (key unchanged)`);
                }

                migratedThreads++;
            } catch (error) {
                console.error(`  ✗ Error migrating "${oldKey}":`, error);
                skippedThreads++;
            }
        }
    }

    await redis.quit();

    console.log('\n=== Migration Complete ===');
    console.log(`Total threads found: ${totalThreads}`);
    console.log(`Successfully migrated: ${migratedThreads}`);
    console.log(`Skipped (errors): ${skippedThreads}`);
    console.log('\nChanges:');
    console.log('  - backendThreadId → id');
    console.log('  - Added agentComboId field');
    console.log('  - Thread hash key changed from threadName to id');
    console.log('  - Created user:{userId}:agent_combos mappings');
}

migrate().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
