import { getUserPermissions } from './redis';
import { FeaturePermissions } from '@/types/auth';

/**
 * Check if user has a specific permission
 */
export async function checkUserPermission(
  userId: string,
  permissionCheck: (permissions: FeaturePermissions) => boolean
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const userPermissions = await getUserPermissions(userId);

    if (!userPermissions) {
      return {
        allowed: false,
        reason: 'User permissions not found',
      };
    }

    const allowed = permissionCheck(userPermissions.permissions);

    return {
      allowed,
      reason: allowed ? undefined : 'Permission denied',
    };
  } catch (error) {
    console.error('Permission check error:', error);
    return {
      allowed: false,
      reason: 'Permission check failed',
    };
  }
}

/**
 * Check if user can import agents
 */
export async function canImportAgent(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  return checkUserPermission(userId, (permissions) => permissions.importAgent === true);
}

/**
 * Check if user can place agents
 * Returns true if:
 * - placeAgent is true (unlimited), OR
 * - placeAgent is a number > 0 (has quota)
 */
export async function canPlaceAgent(
  userId: string,
  currentPlacedCount?: number
): Promise<{ allowed: boolean; reason?: string; remaining?: number }> {
  try {
    const userPermissions = await getUserPermissions(userId);

    if (!userPermissions) {
      return {
        allowed: false,
        reason: 'User permissions not found',
      };
    }

    const { placeAgent } = userPermissions.permissions;

    // If placeAgent is true, unlimited placement
    if (placeAgent === true) {
      return { allowed: true };
    }

    // If placeAgent is a number, check quota
    if (typeof placeAgent === 'number') {
      const remaining = placeAgent - (currentPlacedCount || 0);
      if (remaining > 0) {
        return { allowed: true, remaining };
      }
      return {
        allowed: false,
        reason: `Agent placement limit reached (${placeAgent})`,
      };
    }

    return {
      allowed: false,
      reason: 'No agent placement permission',
    };
  } catch (error) {
    console.error('Permission check error:', error);
    return {
      allowed: false,
      reason: 'Permission check failed',
    };
  }
}

/**
 * Check if user can place agents on a specific map
 */
export async function canPlaceAgentOnMap(
  userId: string,
  mapName: string
): Promise<{ allowed: boolean; reason?: string }> {
  return checkUserPermission(userId, (permissions) => {
    if (!permissions.placeAllowedMaps) {
      return false;
    }

    // '*' means all maps
    if (permissions.placeAllowedMaps.includes('*')) {
      return true;
    }

    return permissions.placeAllowedMaps.includes(mapName);
  });
}

/**
 * Check if user can build on maps
 */
export async function canBuildOnMap(
  userId: string,
  mapName: string
): Promise<{ allowed: boolean; reason?: string }> {
  return checkUserPermission(userId, (permissions) => {
    if (!permissions.mapBuild) {
      return false;
    }

    if (!permissions.buildAllowedMaps) {
      return false;
    }

    // '*' means all maps
    if (permissions.buildAllowedMaps.includes('*')) {
      return true;
    }

    return permissions.buildAllowedMaps.includes(mapName);
  });
}

/**
 * Check if user has admin access
 */
export async function hasAdminAccess(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  return checkUserPermission(userId, (permissions) => permissions.adminAccess === true);
}
