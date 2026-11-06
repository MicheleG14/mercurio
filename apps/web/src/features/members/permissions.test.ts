import { togglePermission } from './permissions';
import type { PermissionInfo } from './queries';

const p = (key: PermissionInfo['key'], requires: string[] = []): PermissionInfo => ({
  key,
  module: 'invoicing',
  moduleEnabled: true,
  requires,
  reserved: false,
});
const catalog = [
  p('invoicing:read'),
  p('invoicing:write', ['invoicing:read']),
  p('invoicing:issue', ['invoicing:write']),
  p('payments:write', ['invoicing:read']),
];

describe('role editor', () => {
  it('ticks what a permission needs, the whole chain', () => {
    expect(togglePermission(catalog, [], 'invoicing:issue', true)).toEqual([
      'invoicing:read',
      'invoicing:write',
      'invoicing:issue',
    ]);
  });

  it('takes away what depends on a permission removed', () => {
    const all = catalog.map((x) => x.key);
    expect(togglePermission(catalog, all, 'invoicing:read', false)).toEqual([]);
    expect(togglePermission(catalog, all, 'invoicing:write', false)).toEqual([
      'invoicing:read',
      'payments:write',
    ]);
  });
});
