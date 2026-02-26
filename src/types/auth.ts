import { HolderCheckerContract } from "@/lib/holder-checker/api";

export interface FeaturePermissions {
  importAgent?: boolean;
  placeAgent?: boolean | number;
  placeAllowedMaps?: string[];
  mapBuild?: boolean;
  buildAllowedMaps?: string[];
  adminAccess?: boolean;
}

export interface AuthDefinition {
  name: string;
  permissions: FeaturePermissions;
  tokenRequirements: HolderCheckerContract[];
}

export interface AuthDefinitionRaw {
  name: string;
  permissions: string;
  tokenRequirements: string;
}

export interface UserPermissions {
  userId: string;
  auths: string[];
  permissions: FeaturePermissions;
  authCheckedAt?: string; // ISO timestamp of last auth verification
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  required?: Partial<FeaturePermissions>;
}
