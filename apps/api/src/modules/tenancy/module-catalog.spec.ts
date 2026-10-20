import { applyModuleChange, parseModuleKeys } from './module-catalog.js';

describe('module catalog', () => {
  describe('parseModuleKeys', () => {
    it('accepts known keys, once each', () => {
      expect(parseModuleKeys(['warehouse', 'registry', 'warehouse'])).toEqual([
        'warehouse',
        'registry',
      ]);
    });

    it('expands "all" to every module', () => {
      expect(parseModuleKeys(['all'])).toEqual(['registry', 'warehouse', 'orders', 'invoicing']);
    });

    it('rejects unknown keys', () => {
      expect(() => parseModuleKeys(['warehouse', 'payroll'])).toThrow(
        expect.objectContaining({ code: 'UNKNOWN_MODULE' }),
      );
    });
  });

  describe('applyModuleChange', () => {
    it('always keeps the registry on', () => {
      expect(applyModuleChange([], {})).toEqual(['registry']);
      expect(applyModuleChange([], { enable: ['invoicing'] })).toEqual(['registry', 'invoicing']);
    });

    it('enables a module whose requirements are present', () => {
      expect(applyModuleChange(['registry', 'warehouse'], { enable: ['orders'] })).toEqual([
        'registry',
        'warehouse',
        'orders',
      ]);
    });

    it('refuses a module without what it requires, instead of enabling it silently', () => {
      expect(() => applyModuleChange(['registry'], { enable: ['orders'] })).toThrow(
        expect.objectContaining({ code: 'MODULE_DEPENDENCY_MISSING' }),
      );
    });

    it('refuses to disable a module another enabled module needs', () => {
      expect(() =>
        applyModuleChange(['registry', 'warehouse', 'orders'], { disable: ['warehouse'] }),
      ).toThrow(expect.objectContaining({ code: 'MODULE_REQUIRED_BY_OTHER' }));
    });

    it('allows disabling a module together with those that need it', () => {
      expect(
        applyModuleChange(['registry', 'warehouse', 'orders'], {
          disable: ['warehouse', 'orders'],
        }),
      ).toEqual(['registry']);
    });

    it('refuses to disable the always-on registry', () => {
      expect(() => applyModuleChange(['registry'], { disable: ['registry'] })).toThrow(
        expect.objectContaining({ code: 'MODULE_ALWAYS_ON' }),
      );
    });
  });
});
