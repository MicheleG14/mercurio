// Public surface of the tenancy module: other modules import from here only (B3).
export { MODULE_KEYS, type ModuleKey, parseModuleKeys } from './module-catalog.js';
export { RequiresModule } from './requires-module.js';
export { TenancyModule } from './tenancy.module.js';
export { type CompanyInput, TenancyService } from './tenancy.service.js';
