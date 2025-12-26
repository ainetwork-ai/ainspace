import { FeaturePermissions, PermissionCheckResult } from '@/types/auth';

export const canImportAgent = (
  permissions: FeaturePermissions
): PermissionCheckResult => {
  if (isAdmin(permissions)) {
    return { allowed: true };
  }

  if (permissions.importAgent) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: '에이전트 import 권한이 없습니다',
    required: { importAgent: true },
  };
};

export const canPlaceAgent = (
  permissions: FeaturePermissions,
  currentCount: number
): PermissionCheckResult => {
  if (isAdmin(permissions)) {
    return { allowed: true };
  }

  if (!permissions.placeAgent) {
    return {
      allowed: false,
      reason: '에이전트 배치 권한이 없습니다',
      required: { placeAgent: true },
    };
  }

  if (permissions.placeAgent === true) {
    return { allowed: true };
  }

  const maxCount =
    typeof permissions.placeAgent === 'number' ? permissions.placeAgent : 0;

  if (currentCount >= maxCount) {
    return {
      allowed: false,
      reason: `최대 ${maxCount}개의 에이전트만 배치할 수 있습니다`,
      required: { placeAgent: maxCount + 1 },
    };
  }

  return { allowed: true };
};

export const canPlaceAgentInMap = (
  permissions: FeaturePermissions,
  mapName: string
): PermissionCheckResult => {
  if (isAdmin(permissions)) {
    return { allowed: true };
  }

  if (!permissions.placeAllowedMaps || permissions.placeAllowedMaps.length === 0) {
    return {
      allowed: false,
      reason: '에이전트 배치 권한이 없습니다',
      required: { placeAllowedMaps: [mapName] },
    };
  }

  if (permissions.placeAllowedMaps.includes('*')) {
    return { allowed: true };
  }

  if (permissions.placeAllowedMaps.includes(mapName)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `${mapName}에 에이전트를 배치할 권한이 없습니다`,
    required: { placeAllowedMaps: [mapName] },
  };
};

export const canBuildMap = (
  permissions: FeaturePermissions
): PermissionCheckResult => {
  if (isAdmin(permissions)) {
    return { allowed: true };
  }

  if (permissions.mapBuild) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: '맵 빌드 권한이 없습니다',
    required: { mapBuild: true },
  };
};

/**
 * 특정 마을에서 빌드 권한 체크
 */
export const canBuildInMap = (
  permissions: FeaturePermissions,
  mapName: string
): PermissionCheckResult => {
  if (isAdmin(permissions)) {
    return { allowed: true };
  }

  if (!permissions.mapBuild) {
    return {
      allowed: false,
      reason: '맵 빌드 권한이 없습니다',
      required: { mapBuild: true },
    };
  }

  if (!permissions.buildAllowedMaps || permissions.buildAllowedMaps.length === 0) {
    return {
      allowed: false,
      reason: '빌드 가능한 마을이 없습니다',
      required: { buildAllowedMaps: [mapName] },
    };
  }

  if (permissions.buildAllowedMaps.includes('*')) {
    return { allowed: true };
  }

  if (permissions.buildAllowedMaps.includes(mapName)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `${mapName}에서 빌드할 권한이 없습니다`,
    required: { buildAllowedMaps: [mapName] },
  };
};

export const isAdmin = (permissions: FeaturePermissions): boolean => {
  return permissions.adminAccess === true;
};
