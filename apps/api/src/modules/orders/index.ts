// Public surface of the orders module: other modules import from here only (B3).
export { type CreateFulfilmentDto, type CreateOrderDto, type OrderDto } from './orders.dto.js';
export { OrdersModule } from './orders.module.js';
export { OrdersService } from './orders.service.js';
