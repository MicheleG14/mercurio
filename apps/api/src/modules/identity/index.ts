// Public surface of the identity module: other modules import from here only (B3).
export { type CompanyAccess, canAccessCompany } from './company-access.js';
export { IdentityModule } from './identity.module.js';
export { IdentityService, type MemberInput, ROLES } from './identity.service.js';
export {
  PERMISSIONS,
  type Permission,
  permissionsFor,
  REQUIRED_PERMISSION,
  RequiresPermission,
  ROLE_PERMISSIONS,
} from './permissions.js';
