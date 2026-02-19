import { useEffect, useState } from 'react';
import { VillageMetadata } from '@/lib/village-redis';

/**
 * Fetch all villages from the API
 */
export function useVillages() {
  const [villages, setVillages] = useState<VillageMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchVillages() {
      try {
        const res = await fetch('/api/villages');
        const data = await res.json();

        if (data.success && data.villages) {
          setVillages(data.villages);
        } else {
          throw new Error('Failed to fetch villages');
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setIsLoading(false);
      }
    }

    fetchVillages();
  }, []);

  return { villages, isLoading, error };
}

/**
 * Get village display name from slug
 * Falls back to slug if village not found
 */
export function getVillageDisplayName(slug: string, villages: VillageMetadata[]): string {
  const village = villages.find(v => v.slug === slug);
  return village?.name || slug;
}
