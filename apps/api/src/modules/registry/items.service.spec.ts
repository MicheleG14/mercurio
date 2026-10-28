import { Prisma, type Item } from '../../generated/prisma/client.js';
import type { TenantContextService, TenantDatabase } from '../../prisma/index.js';
import type { AuditService } from '../audit/index.js';
import type { ItemsRepository } from './items.repository.js';
import { ItemsService } from './items.service.js';

// Whether an item is kept in stock is fixed at creation. The API role is losing the privilege to
// update the column (B13: one release after the API stopped writing it), so an update must not
// write it at all, not even with the value it already has.
describe('ItemsService', () => {
  const stored: Item = {
    id: '0190a000-0000-7000-8000-000000000001',
    tenantId: '0190a000-0000-7000-8000-000000000002',
    code: 'VT-1',
    description: 'Vite',
    unit: 'PZ',
    vatCode: '22',
    salePrice: new Prisma.Decimal('0.1'),
    stockManaged: true,
    notes: null,
    version: 1,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function serviceWith(repository: Partial<ItemsRepository>) {
    const db = { run: (work: (tx: unknown) => unknown) => work({}) } as unknown as TenantDatabase;
    const contexts = {
      require: () => ({ tenantId: stored.tenantId, userId: 'u' }),
    } as unknown as TenantContextService;
    const audit = { recordTenantEvent: vi.fn() } as unknown as AuditService;
    return new ItemsService(repository as ItemsRepository, db, contexts, audit);
  }

  it('never writes stock_managed when an item changes', async () => {
    const updateAtVersion = vi.fn(
      async (_db: unknown, _id: string, _version: number, data: object) => ({
        ...stored,
        ...data,
        version: 2,
      }),
    );
    const service = serviceWith({ findById: async () => stored, updateAtVersion } as never);

    await service.update(stored.id, { version: 1, description: 'Vite M6' });

    const data = updateAtVersion.mock.calls[0]![3];
    expect(data).toMatchObject({ description: 'Vite M6' });
    expect(data).not.toHaveProperty('stockManaged');
  });

  it('still sets it when an item is created', async () => {
    const create = vi.fn(async (_db: unknown, data: object) => ({ ...stored, ...data }));
    const service = serviceWith({ codeExists: async () => false, create } as never);

    await service.create({
      code: 'mo-1',
      description: 'Ore',
      unit: 'H',
      vatCode: '22',
      stockManaged: false,
    });

    expect(create.mock.calls[0]![1]).toMatchObject({ stockManaged: false });
  });
});
