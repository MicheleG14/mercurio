import { json, me, session } from '@/test/api-mock';
import type { Item, Party, ReferenceData } from './queries';

// Fictitious records for the component tests of the registry.

export const referenceData: ReferenceData = {
  vatCodes: [
    { code: '22', rate: '22.00', nature: null },
    { code: '10', rate: '10.00', nature: null },
    { code: 'N4', rate: '0.00', nature: 'N4' },
    { code: 'N2.1', rate: '0.00', nature: 'N2.1' },
  ],
  units: ['PZ', 'KG', 'H'],
  legalForms: [
    { code: 'SRL', category: 'CAPITAL' },
    { code: 'SNC', category: 'PARTNERSHIP' },
    { code: 'OTHER', category: null },
  ],
};

export const party = (overrides: Partial<Party> = {}): Party => ({
  id: 'p1',
  kind: 'COMPANY',
  isCustomer: true,
  isSupplier: false,
  name: 'Ferramenta Bruni Srl',
  legalName: 'Ferramenta Bruni Srl',
  firstName: null,
  lastName: null,
  legalForm: 'SRL',
  vatNumber: '12345678903',
  taxCode: null,
  country: 'IT',
  address: 'Via Torino 12',
  postalCode: '20123',
  city: 'Milano',
  province: 'MI',
  email: null,
  phone: null,
  pecEmail: null,
  sdiCode: null,
  notes: null,
  version: 3,
  archivedAt: null,
  createdAt: '2026-10-21T08:00:00.000Z',
  updatedAt: '2026-10-21T08:00:00.000Z',
  ...overrides,
});

export const item = (overrides: Partial<Item> = {}): Item => ({
  id: 'i1',
  code: 'VT-M6-20',
  description: 'Vite a testa esagonale M6x20',
  unit: 'PZ',
  vatCode: '22',
  salePrice: '0.1200',
  stockManaged: true,
  notes: null,
  version: 1,
  archivedAt: null,
  createdAt: '2026-10-21T08:00:00.000Z',
  updatedAt: '2026-10-21T08:00:00.000Z',
  ...overrides,
});

export const page = <T>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 25 });

/** Signed in to Gruppo Rossi with the given permissions (all of the registry by default). */
export const signedInWith = (permissions?: string[]) => ({
  'POST /auth/refresh': () => json(200, session('t-rossi')),
  'GET /auth/me': () => json(200, me(permissions ? { permissions } : {})),
  'GET /registry/reference-data': () => json(200, referenceData),
});
