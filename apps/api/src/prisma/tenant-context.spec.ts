import { TenantContextService } from './tenant-context.js';

const A = { tenantId: '00000000-0000-7000-8000-00000000000a' };
const B = { tenantId: '00000000-0000-7000-8000-00000000000b' };

describe('TenantContextService', () => {
  const service = new TenantContextService();

  it('has no context outside run()', () => {
    expect(service.current()).toBeUndefined();
    expect(() => service.require()).toThrow(/No tenant context/);
  });

  it('keeps the context across awaits inside run()', async () => {
    const seen = await service.run(A, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return service.require();
    });

    expect(seen).toEqual(A);
    expect(service.current()).toBeUndefined();
  });

  it('keeps concurrent operations apart', async () => {
    const read = (context: typeof A) =>
      service.run(context, async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        return service.require().tenantId;
      });

    const results = await Promise.all([read(A), read(B), read(A), read(B)]);

    expect(results).toEqual([A.tenantId, B.tenantId, A.tenantId, B.tenantId]);
  });
});
