export interface FeaturePermissions {
  importAgent?: boolean;
  placeAgent?: boolean | number;
  placeAllowedMaps?: string[];
  mapBuild?: boolean;
  buildAllowedMaps?: string[];
  adminAccess?: boolean;
}

export interface TokenRequirement {
  type: string;
  chain: string;
  address: string;
  minAmount?: number;
}

export interface AuthDefinition {
  name: string;
  permissions: FeaturePermissions;
  tokenRequirements: TokenRequirement[];
}

export interface AuthDefinitionRaw {
  name: string;
  permissions: string;
  tokenRequirements: string;
}

export interface UserPermissions {
  userId: string;
  address: string;
  auths: string[];
  permissions: FeaturePermissions;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  required?: Partial<FeaturePermissions>;
}
