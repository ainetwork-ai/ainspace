import { FeaturePermissions, AuthDefinition } from '@/types/auth';
import { DEFAULT_PERMISSIONS } from './redis';

export const mergePermissions = (
  permissionsList: FeaturePermissions[]
): FeaturePermissions => {
  const merged: FeaturePermissions = { ...DEFAULT_PERMISSIONS };

  permissionsList.forEach(perms => {
    if (perms.importAgent) merged.importAgent = true;
    if (perms.mapBuild) merged.mapBuild = true;
    if (perms.adminAccess) merged.adminAccess = true;

    // placeAgent: 최대값 사용 (true가 있으면 무제한)
    if (perms.placeAgent !== undefined) {
      if (merged.placeAgent === true) {
        // 이미 무제한이면 유지
      } else if (perms.placeAgent === true) {
        merged.placeAgent = true;
      } else if (typeof perms.placeAgent === 'number') {
        const currentMax =
          typeof merged.placeAgent === 'number' ? merged.placeAgent : 0;
        merged.placeAgent = Math.max(currentMax, perms.placeAgent);
      }
    }

    // placeAllowedMaps: 합집합
    if (perms.placeAllowedMaps && perms.placeAllowedMaps.length > 0) {
      if (merged.placeAllowedMaps?.includes('*')) {
        // 이미 모든 마을 접근 가능
      } else if (perms.placeAllowedMaps.includes('*')) {
        merged.placeAllowedMaps = ['*'];
      } else {
        const current = merged.placeAllowedMaps || [];
        merged.placeAllowedMaps = [
          ...new Set([...current, ...perms.placeAllowedMaps]),
        ];
      }
    }

    // buildAllowedMaps: 합집합
    if (perms.buildAllowedMaps && perms.buildAllowedMaps.length > 0) {
      if (merged.buildAllowedMaps?.includes('*')) {
        // 이미 모든 마을 접근 가능
      } else if (perms.buildAllowedMaps.includes('*')) {
        merged.buildAllowedMaps = ['*'];
      } else {
        const current = merged.buildAllowedMaps || [];
        merged.buildAllowedMaps = [
          ...new Set([...current, ...perms.buildAllowedMaps]),
        ];
      }
    }
  });

  return merged;
};

export const calculateUserPermissions = (
  authNames: string[],
  authDefinitions: AuthDefinition[]
): FeaturePermissions => {
  const relevantAuths = authDefinitions.filter(auth =>
    authNames.includes(auth.name)
  );

  const permissionsList = relevantAuths.map(auth => auth.permissions);

  return mergePermissions(permissionsList);
};
