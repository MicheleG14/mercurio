// Public surface of the warehouse module: other modules import from here only (B3).
export { type CompanyContext } from './company-context.js';
export { type CreateStockDocumentDto } from './stock-documents.dto.js';
export { businessToday } from './stock-rules.js';
export { WarehouseModule } from './warehouse.module.js';
export { WarehouseService } from './warehouse.service.js';
