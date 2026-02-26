import { getRedisClient, scanKeys } from '@/lib/redis';
import {
  AuthDefinition,
  AuthDefinitionRaw,
  UserPermissions,
  FeaturePermissions,
} from '@/types/auth';
import { calculateUserPermissions } from './merge';

// 기본 권한 (모든 사용자)
export const DEFAULT_PERMISSIONS: FeaturePermissions = {
  importAgent: false,
  placeAgent: false,
  placeAllowedMaps: [],
  mapBuild: false,
  buildAllowedMaps: [],
  adminAccess: false,
};

// Redis Key 관련 상수
export const AUTH_KEY_PREFIX = 'auth';
export const USER_KEY_PREFIX = 'user';
export const AUTH_FIELD_NAME = 'auth';
export const PERMISSIONS_FIELD_NAME = 'permissions';

export const saveAuthDefinition = async (
  auth: AuthDefinition
): Promise<void> => {
  const redis = await getRedisClient();
  const key = `${AUTH_KEY_PREFIX}:${auth.name}`;

  await redis.hSet(key, {
    name: auth.name,
    permissions: JSON.stringify(auth.permissions),
    tokenRequirements: JSON.stringify(auth.tokenRequirements),
  });
};

export const getAuthDefinition = async (
  authName: string
): Promise<AuthDefinition | null> => {
  const redis = await getRedisClient();
  const key = `${AUTH_KEY_PREFIX}:${authName}`;

  const data = await redis.hGetAll(key);

  if (!data || Object.keys(data).length === 0) {
    return null;
  }

  const raw = data as unknown as AuthDefinitionRaw;

  return {
    name: raw.name,
    permissions: JSON.parse(raw.permissions),
    tokenRequirements: JSON.parse(raw.tokenRequirements),
  };
};

export const getAuthDefinitions = async (
  authNames: string[]
): Promise<AuthDefinition[]> => {
  const definitions = await Promise.all(
    authNames.map(name => getAuthDefinition(name))
  );

  return definitions.filter(
    (def): def is AuthDefinition => def !== null
  );
}

export const getAllAuthDefinitions = async (): Promise<AuthDefinition[]> => {
  const keys = await scanKeys(`${AUTH_KEY_PREFIX}:*`);

  if (!keys || keys.length === 0) {
    return [];
  }

  const redis = await getRedisClient();

  const definitions = await Promise.all(
    keys.map(async (key) => {
      const data = await redis.hGetAll(key);

      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      const raw = data as unknown as AuthDefinitionRaw;

      return {
        name: raw.name,
        permissions: JSON.parse(raw.permissions),
        tokenRequirements: JSON.parse(raw.tokenRequirements),
      };
    })
  );

  return definitions.filter(
    (def): def is AuthDefinition => def !== null
  );
}

export const deleteAuthDefinition = async (
  authName: string
): Promise<void> => {
  const redis = await getRedisClient();
  const key = `${AUTH_KEY_PREFIX}:${authName}`;
  await redis.del(key);
};

export const saveUserAuths = async (
  userId: string,
  auths: string[]
): Promise<void> => {
  const redis = await getRedisClient();
  const key = `${USER_KEY_PREFIX}:${userId}`;

  const authDefinitions = await getAuthDefinitions(auths);

  const permissions = calculateUserPermissions(auths, authDefinitions);

  await redis.hSet(key, {
    userId,
    [AUTH_FIELD_NAME]: JSON.stringify(auths),
    [PERMISSIONS_FIELD_NAME]: JSON.stringify(permissions),
    authCheckedAt: new Date().toISOString(),
    authVersion: '1.0',
  });
};

export const getUserPermissions = async (
  userId: string
): Promise<UserPermissions | null> => {
  const redis = await getRedisClient();
  const key = `${USER_KEY_PREFIX}:${userId}`;

  const data = await redis.hGetAll(key);

  if (!data || Object.keys(data).length === 0) {
    return null;
  }

  const auths: string[] = data[AUTH_FIELD_NAME]
    ? JSON.parse(data[AUTH_FIELD_NAME])
    : [];
  const permissions: FeaturePermissions = data[PERMISSIONS_FIELD_NAME]
    ? JSON.parse(data[PERMISSIONS_FIELD_NAME])
    : {};

  return {
    userId: data.userId || userId,
    auths,
    permissions,
    authCheckedAt: data.authCheckedAt,
  };
};

export const getUserAuths = async (userId: string): Promise<string[]> => {
  const redis = await getRedisClient();
  const key = `${USER_KEY_PREFIX}:${userId}`;

  const authData = await redis.hGet(key, AUTH_FIELD_NAME);

  if (!authData) {
    return [];
  }

  return JSON.parse(authData) as string[];
};

export const deleteUserPermissions = async (userId: string): Promise<void> => {
  const redis = await getRedisClient();
  const key = `${USER_KEY_PREFIX}:${userId}`;

  await redis.hDel(key, AUTH_FIELD_NAME);
  await redis.hDel(key, PERMISSIONS_FIELD_NAME);
};
