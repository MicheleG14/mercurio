import type { IdentityService } from '../modules/identity/index.js';
import type { PartyInput, RegistryService } from '../modules/registry/index.js';
import type { TenancyService } from '../modules/tenancy/index.js';
import type { OrdersService } from '../modules/orders/index.js';
import type { CreateStockDocumentDto, WarehouseService } from '../modules/warehouse/index.js';
import { uuidv7 } from '../shared/uuid.js';
import type { DbClient } from '../prisma/index.js';
import { italianCheckDigit, personalTaxCodeCheckChar } from '../shared/italian-identifiers.js';

/**
 * Fictitious demo data (S2, S8; docs/conventions.md B21): two tenants that show both the
 * company and the tenant boundaries. Content is deterministic; emails use example.com, a domain
 * reserved for examples (RFC 2606), and VAT numbers and tax codes are made up with a valid check
 * character.
 *
 * - rossi: two companies, one person per role, two people limited to one company; a registry
 *   with every kind of party (one archived, one abroad) and goods and services;
 * - bianchi: one company, its own admin, a small registry of its own;
 * - Paola Conti, a consultant, belongs to both tenants with a different role in each (S4).
 *
 * The command gives every demo person the same fictitious password and authenticator secret
 * (outside production), so the demo can be signed into.
 */
export const DEMO_PASSWORD = 'Demo-password-2026';
/** Base32 secret shared by all demo people: add it to any authenticator app to get the codes. */
export const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export const DEMO = {
  tenants: [
    {
      slug: 'rossi',
      name: 'Gruppo Rossi',
      modules: ['all'],
      companies: [
        { legalName: 'Rossi Srl', vatNumber: withCheckDigit('0274651096') },
        { legalName: 'Rossi Logistica Srl', vatNumber: withCheckDigit('0381927364') },
      ],
      members: [
        { email: 'anna.rossi', name: 'Anna Rossi', role: 'ADMIN', companies: 'all' },
        { email: 'sara.neri', name: 'Sara Neri', role: 'ACCOUNTANT', companies: 'all' },
        { email: 'marco.verdi', name: 'Marco Verdi', role: 'WAREHOUSE_KEEPER', companies: [1] },
        { email: 'luca.gallo', name: 'Luca Gallo', role: 'READ_ONLY', companies: [0] },
        { email: 'paola.conti', name: 'Paola Conti', role: 'ACCOUNTANT', companies: 'all' },
      ],
      parties: [
        company('Ferramenta Bruni Srl', '0612345678', 'SRL', 'customer', {
          address: 'Via Torino 12',
          postalCode: '20123',
          city: 'Milano',
          province: 'MI',
          email: 'ordini@ferramenta-bruni.example.com',
          sdiCode: 'M5UXCR1',
        }),
        company('Edilnord Spa', '0723456789', 'SPA', 'both', {
          address: 'Via Bergamo 140',
          postalCode: '24047',
          city: 'Treviglio',
          province: 'BG',
          pecEmail: 'edilnord@pec.example.com',
          sdiCode: '0000000',
        }),
        company('Viteria Lombarda Srl', '0834567890', 'SRL', 'supplier', {
          address: 'Via dei Mille 8',
          postalCode: '25122',
          city: 'Brescia',
          province: 'BS',
          phone: '030 123456',
        }),
        {
          kind: 'SOLE_TRADER',
          isCustomer: true,
          isSupplier: false,
          legalName: 'Studio Tecnico Marino',
          firstName: 'Luca',
          lastName: 'Marino',
          vatNumber: withCheckDigit('0945678901'),
          taxCode: withCheckChar('MRNLCU79L04F704'),
          city: 'Monza',
          province: 'MB',
          postalCode: '20900',
        },
        {
          kind: 'PRIVATE',
          isCustomer: true,
          isSupplier: false,
          firstName: 'Giulia',
          lastName: 'Ferri',
          taxCode: withCheckChar('FRRGLI85C52C933'),
          address: 'Via Milano 3',
          postalCode: '22100',
          city: 'Como',
          province: 'CO',
          email: 'giulia.ferri@example.com',
        },
        {
          kind: 'ORGANIZATION',
          isCustomer: true,
          isSupplier: false,
          legalName: 'Associazione Sportiva Lario',
          taxCode: withCheckDigit('9301234567'),
          city: 'Lecco',
          province: 'LC',
          postalCode: '23900',
        },
        {
          kind: 'COMPANY',
          isCustomer: true,
          isSupplier: false,
          legalName: 'Baustoffe Müller GmbH',
          vatNumber: 'DE811234567',
          country: 'DE',
          address: 'Hauptstraße 5',
          postalCode: '80331',
          city: 'München',
          notes: 'Prezzi concordati in euro.',
        },
        {
          ...company('Elettroforniture Riva Snc', '1056789012', 'SNC', 'supplier', {
            city: 'Varese',
            province: 'VA',
          }),
          notes: 'Non più attivo: sostituito da Viteria Lombarda.',
          archived: true,
        },
      ],
      items: [
        good('VT-M6-20', 'Vite a testa esagonale M6x20 zincata', 'PZ', '0.12'),
        good('VT-M8-30', 'Vite a testa esagonale M8x30 zincata', 'PZ', '0.18'),
        good('DD-M6', 'Dado esagonale M6', 'PZ', '0.05'),
        good('RN-M6', 'Rondella piana M6', 'PZ', '0.03'),
        good('TS-8', 'Tasselli in nylon 8 mm (100 pezzi)', 'CF', '4.90'),
        good('CH-BRU', 'Set di chiavi a brugola', 'SET', '12.50'),
        good('TR-18V', 'Trapano avvitatore a batteria 18 V', 'PZ', '89.00'),
        good('SM-125', 'Smerigliatrice angolare 125 mm', 'PZ', '64.90'),
        good('CV-3G15', 'Cavo elettrico 3G1,5', 'M', '0.85'),
        good('CM-PORT', 'Cemento Portland', 'KG', '0.22'),
        good('VR-BIA', 'Idropittura bianca', 'L', '7.80'),
        good('GU-NIT', 'Guanti in nitrile (50 pezzi)', 'CF', '6.40'),
        good('MAN-INST', 'Manuale di installazione (libro)', 'PZ', '18.00', '4'),
        service('MDO-ORA', 'Manodopera specializzata', 'H', '35.00', '22'),
        service('CORSO-SIC', 'Corso di formazione sulla sicurezza', 'H', '50.00', 'N4'),
      ],
      // Per company (by position in `companies`): warehouses, documents in date order, reorder
      // levels. Parties are named by the first 10 digits of their VAT number, as above.
      warehouse: [
        {
          warehouses: [
            { code: 'SEDE', name: 'Magazzino della sede' },
            { code: 'DEP', name: 'Deposito Nord' },
          ],
          documents: [
            doc('OPENING', '2026-09-01', 'SEDE', [
              ['VT-M6-20', '2000'],
              ['VT-M8-30', '1500'],
              ['DD-M6', '3000'],
              ['RN-M6', '3000'],
              ['TS-8', '40'],
              ['CH-BRU', '12'],
              ['TR-18V', '6'],
              ['SM-125', '4'],
              ['CV-3G15', '250'],
              ['CM-PORT', '500'],
              ['VR-BIA', '60'],
              ['GU-NIT', '30'],
              ['MAN-INST', '10'],
            ]),
            doc(
              'PURCHASE_RECEIPT',
              '2026-09-15',
              'SEDE',
              [
                ['VT-M6-20', '1000'],
                ['DD-M6', '1000'],
              ],
              {
                party: '0834567890',
                ref: 'VL-2026/0815',
                refDate: '2026-09-14',
              },
            ),
            doc(
              'SALE_ISSUE',
              '2026-09-22',
              'SEDE',
              [
                ['VT-M6-20', '1800'],
                ['DD-M6', '1200'],
                ['TR-18V', '4'],
              ],
              {
                party: '0612345678',
              },
            ),
            doc('INTERNAL_USE', '2026-09-25', 'SEDE', [['GU-NIT', '4']], {
              notes: 'Uso in officina',
            }),
            doc(
              'TRANSFER',
              '2026-09-29',
              'SEDE',
              [
                ['CM-PORT', '200'],
                ['VR-BIA', '20'],
              ],
              { target: 'DEP' },
            ),
            // Recorded with the wrong supplier and reversed the next day.
            doc('PURCHASE_RECEIPT', '2026-10-02', 'SEDE', [['CM-PORT', '300']], {
              party: '0723456789',
              ref: 'EN 4471',
              reverseOn: '2026-10-03',
            }),
            doc('INVENTORY_ADJUSTMENT', '2026-10-05', 'SEDE', [['TS-8', '37']]),
            doc('LOSS', '2026-10-08', 'SEDE', [['SM-125', '1']], { notes: 'Caduta dal bancale' }),
            doc('CUSTOMER_RETURN', '2026-10-12', 'SEDE', [['TR-18V', '1']], {
              party: '0612345678',
            }),
          ],
          // TR-18V (3 left), SM-125 (3) and GU-NIT (26) end up below their reorder point.
          reorderLevels: [
            { warehouse: 'SEDE', item: 'TR-18V', reorderPoint: '5', reorderQuantity: '10' },
            { warehouse: 'SEDE', item: 'SM-125', reorderPoint: '3', reorderQuantity: '5' },
            { warehouse: 'SEDE', item: 'GU-NIT', reorderPoint: '30', reorderQuantity: '50' },
            { warehouse: 'SEDE', item: 'VT-M6-20', reorderPoint: '500', reorderQuantity: '2000' },
          ],
        },
        {
          warehouses: [{ code: 'HUB', name: 'Hub logistico' }],
          documents: [
            doc('OPENING', '2026-09-01', 'HUB', [
              ['CV-3G15', '1000'],
              ['CM-PORT', '2000'],
              ['GU-NIT', '50'],
            ]),
            doc('SALE_ISSUE', '2026-10-06', 'HUB', [['CM-PORT', '1200']], { party: '0723456789' }),
          ],
          reorderLevels: [
            { warehouse: 'HUB', item: 'CM-PORT', reorderPoint: '1000', reorderQuantity: '2000' },
          ],
        },
      ],
      // Per company: orders in the order they are recorded, purchases first so the goods are
      // there when sales reserve them. Lines as [item code, quantity, unit price, discount].
      // Every status shows up: received in two deliveries, partial, incoming, cancelled, draft;
      // shipped, partial, reserved, uncovered and late, a shipment undone, a rest closed.
      orders: [
        {
          warehouse: 'SEDE',
          orders: [
            order(
              'PURCHASE',
              '2026-10-13',
              '0834567890',
              [
                ['VT-M6-20', '2000', '0.06'],
                ['DD-M6', '1000', '0.025'],
              ],
              {
                ref: 'Conf. VL 1022',
                requested: '2026-10-20',
                fulfil: [
                  {
                    date: '2026-10-16',
                    ref: 'VL-2026/0901',
                    lines: [
                      ['VT-M6-20', '1000'],
                      ['DD-M6', '1000'],
                    ],
                  },
                  { date: '2026-10-21', ref: 'VL-2026/0933', lines: [['VT-M6-20', '1000']] },
                ],
              },
            ),
            order('PURCHASE', '2026-10-19', '0723456789', [['CM-PORT', '1000', '0.15']], {
              requested: '2026-10-30',
              fulfil: [{ date: '2026-10-22', ref: 'EN 4520', lines: [['CM-PORT', '400']] }],
            }),
            order(
              'PURCHASE',
              '2026-10-24',
              '0834567890',
              [
                ['TR-18V', '10', '55'],
                ['SM-125', '5', '40'],
              ],
              {
                requested: '2026-11-05',
              },
            ),
            order('PURCHASE', '2026-10-06', '0723456789', [['VR-BIA', '50', '4.5']], {
              cancelOn: '2026-10-07',
              notes: 'Annullato: prezzo non confermato dal fornitore.',
            }),
            order('PURCHASE', '2026-10-27', '0834567890', [['GU-NIT', '50', '3.2']], {
              draft: true,
            }),
            order(
              'SALES',
              '2026-10-14',
              '0612345678',
              [
                ['VT-M6-20', '500', '0.12'],
                ['TS-8', '10', '4.90'],
              ],
              {
                ref: 'ORD 2026/311',
                fulfil: [
                  {
                    date: '2026-10-15',
                    lines: [
                      ['VT-M6-20', '500'],
                      ['TS-8', '10'],
                    ],
                  },
                ],
              },
            ),
            order(
              'SALES',
              '2026-10-20',
              '0723456789',
              [
                ['CM-PORT', '200', '0.22'],
                ['CV-3G15', '100', '0.85'],
              ],
              {
                requested: '2026-11-02',
                fulfil: [{ date: '2026-10-21', lines: [['CM-PORT', '100']] }],
              },
            ),
            order(
              'SALES',
              '2026-10-26',
              '0945678901',
              [
                ['CH-BRU', '4', '12.50', '5'],
                ['TR-18V', '2', '89'],
              ],
              {
                requested: '2026-11-10',
              },
            ),
            order('SALES', '2026-10-23', 'DE811234567', [['SM-125', '5', '64.90']], {
              ref: 'PO 77812',
              requested: '2026-10-25',
              notes: 'Spedire tutto insieme quando arrivano le smerigliatrici.',
            }),
            order('SALES', '2026-10-09', '0612345678', [['VR-BIA', '4', '7.80']], {
              fulfil: [{ date: '2026-10-10', lines: [['VR-BIA', '4']], reverseOn: '2026-10-11' }],
              notes: 'Prima spedizione annullata: colore sbagliato.',
            }),
            order('SALES', '2026-10-16', '0612345678', [['RN-M6', '1000', '0.03']], {
              fulfil: [{ date: '2026-10-17', lines: [['RN-M6', '600']] }],
              closeOn: '2026-10-18',
              notes: 'Il cliente non vuole il resto.',
            }),
            order(
              'SALES',
              '2026-10-27',
              '0612345678',
              [
                ['GU-NIT', '10', '6.40'],
                ['MAN-INST', '2', '18'],
              ],
              {
                draft: true,
              },
            ),
          ],
        },
        {
          warehouse: 'HUB',
          orders: [
            order('PURCHASE', '2026-10-26', '0723456789', [['CM-PORT', '2000', '0.14']], {
              requested: '2026-11-03',
            }),
            order('SALES', '2026-10-27', '0723456789', [['CM-PORT', '500', '0.20']]),
          ],
        },
      ],
    },
    {
      slug: 'bianchi',
      name: 'Bianchi Snc',
      modules: ['registry', 'invoicing'],
      companies: [{ legalName: 'Bianchi Snc', vatNumber: withCheckDigit('0519283746') }],
      members: [
        { email: 'giorgio.bianchi', name: 'Giorgio Bianchi', role: 'ADMIN', companies: 'all' },
        { email: 'paola.conti', name: 'Paola Conti', role: 'READ_ONLY', companies: 'all' },
      ],
      parties: [
        company('Cartoleria Centrale Srl', '1167890123', 'SRL', 'supplier', {
          city: 'Bologna',
          province: 'BO',
        }),
        company('Studio Associato Gentile', '1278901234', null, 'customer', {
          city: 'Modena',
          province: 'MO',
        }),
      ],
      items: [
        service('CONS-ORA', 'Consulenza amministrativa', 'H', '60.00', '22'),
        good('CARTA-A4', 'Carta A4 80 g (5 risme)', 'CF', '24.90'),
        good('TONER-K', 'Toner nero per stampante laser', 'PZ', '49.00'),
      ],
    },
  ],
} as const;

export interface SeedSummary {
  slug: string;
  /** False when the tenant was already there: its companies and people are left as they are. */
  created: boolean;
  companies: number;
  members: number;
  /** Parties and items added by this run. */
  parties: number;
  items: number;
  /** Warehouses and stock documents added by this run. */
  warehouses: number;
  documents: number;
  /** Orders added by this run. */
  orders: number;
}

/**
 * Creates the demo data in `db` (call it inside one transaction). It only adds what is missing:
 * a demo tenant that exists keeps its companies and people and gets the registry entries it
 * lacks, so the command can run again, also after an upgrade, without duplicating anything.
 * `suffix` exists for tests only: it makes slugs and emails unique, so tests never touch the
 * real demo data.
 */
export async function seedDemo(
  db: DbClient,
  services: {
    tenancy: TenancyService;
    identity: IdentityService;
    registry: RegistryService;
    warehouse: WarehouseService;
    orders: OrdersService;
  },
  suffix = '',
) {
  const slug = (base: string) => (suffix ? `${base}-${suffix}` : base);
  const email = (local: string) => `${local}${suffix ? `.${suffix}` : ''}@example.com`;
  const summary: SeedSummary[] = [];
  const userIds = new Set<string>();

  for (const tenant of DEMO.tenants) {
    let tenantId = (await services.tenancy.findTenantBySlug(db, slug(tenant.slug)))?.id;
    const created = !tenantId;
    if (!tenantId) {
      const [first, ...others] = tenant.companies;
      const made = await services.tenancy.createTenant(db, {
        name: tenant.name,
        slug: slug(tenant.slug),
        modules: tenant.modules,
        company: first,
      });
      tenantId = made.tenant.id;
      const companyIds = [made.company.id];
      for (const company of others) {
        companyIds.push((await services.tenancy.addCompany(db, made.tenant.slug, company)).id);
      }
      for (const member of tenant.members) {
        const added = await services.identity.addMember(db, {
          tenantId,
          email: email(member.email),
          name: member.name,
          role: member.role,
          companies:
            member.companies === 'all'
              ? 'all'
              : member.companies.map((index) => companyIds[index]!),
        });
        userIds.add(added.userId);
      }
    }

    let parties = 0;
    for (const party of tenant.parties) {
      if (await services.registry.addPartyIfMissing(db, tenantId, party)) parties++;
    }
    let items = 0;
    for (const item of tenant.items) {
      if (await services.registry.addItemIfMissing(db, tenantId, item)) items++;
    }
    const stock =
      'warehouse' in tenant
        ? await seedWarehouse(db, services, tenantId, tenant)
        : { warehouses: 0, documents: 0 };
    const orders = 'orders' in tenant ? await seedOrders(db, services, tenantId, tenant) : 0;
    summary.push({
      slug: slug(tenant.slug),
      created,
      companies: tenant.companies.length,
      members: tenant.members.length,
      parties,
      items,
      ...stock,
      orders,
    });
  }
  return { tenants: summary, userIds: [...userIds] };
}

/**
 * Warehouses, documents and reorder levels of a demo tenant. Documents go through the same use
 * case as the API (same rules, locks, numbering), each recorded "on its own day" so the date
 * rules hold whatever today is; they are added only to a company whose warehouses have none.
 */
async function seedWarehouse(
  db: DbClient,
  services: { tenancy: TenancyService; registry: RegistryService; warehouse: WarehouseService },
  tenantId: string,
  tenant: (typeof DEMO.tenants)[0],
) {
  let warehouses = 0;
  let documents = 0;
  const companyIds = await services.tenancy.companyIdsByVat(
    db,
    tenantId,
    tenant.companies.map((c) => c.vatNumber),
  );
  const itemIds = await services.registry.itemIdsByCode(
    db,
    tenantId,
    tenant.items.map((i) => i.code),
  );
  for (const [index, spec] of tenant.warehouse.entries()) {
    const company = { tenantId, companyId: companyIds[index]!, userId: null };
    const warehouseIds = new Map<string, string>();
    let hasDocuments = false;
    for (const warehouse of spec.warehouses) {
      const ensured = await services.warehouse.ensureWarehouse(db, company, warehouse);
      if (ensured.created) warehouses++;
      warehouseIds.set(warehouse.code, ensured.id);
      hasDocuments ||= await services.warehouse.hasDocuments(db, ensured.id);
    }
    if (!hasDocuments) {
      for (const spec_ of spec.documents) {
        const partyId = spec_.party
          ? await services.registry.partyIdByVat(db, tenantId, withCheckDigit(spec_.party))
          : null;
        const counted = spec_.reason === 'INVENTORY_ADJUSTMENT';
        const dto: CreateStockDocumentDto = {
          id: uuidv7(Date.parse(`${spec_.date}T09:00:00Z`)),
          reason: spec_.reason,
          documentDate: spec_.date,
          warehouseId: warehouseIds.get(spec_.warehouse)!,
          targetWarehouseId: spec_.target ? warehouseIds.get(spec_.target)! : null,
          partyId,
          partyDocumentRef: spec_.ref ?? null,
          partyDocumentDate: spec_.refDate ?? null,
          notes: spec_.notes ?? null,
          lines: spec_.lines.map(([code, quantity]) => ({
            itemId: itemIds.get(code)!,
            ...(counted ? { countedQuantity: quantity } : { quantity }),
          })),
        };
        const posted = await services.warehouse.postDocument(db, company, dto, {
          today: spec_.date,
        });
        documents++;
        if (spec_.reverseOn) {
          await services.warehouse.reverseDocument(db, company, posted.id, {
            today: spec_.reverseOn,
          });
          documents++;
        }
      }
    }
    for (const level of spec.reorderLevels) {
      await services.warehouse.setReorderLevelIfMissing(db, company, {
        warehouseId: warehouseIds.get(level.warehouse)!,
        itemId: itemIds.get(level.item)!,
        reorderPoint: level.reorderPoint,
        reorderQuantity: level.reorderQuantity,
      });
    }
  }
  return { warehouses, documents };
}

/**
 * Orders of a demo tenant, added only to a company that has none. Each action goes through the
 * same use case as the API and is recorded "on its own day", like the stock documents: created
 * on the order date, confirmed the same day unless it stays a draft, then received or shipped,
 * undone, closed or cancelled on the dates given.
 */
async function seedOrders(
  db: DbClient,
  services: {
    tenancy: TenancyService;
    registry: RegistryService;
    warehouse: WarehouseService;
    orders: OrdersService;
  },
  tenantId: string,
  tenant: (typeof DEMO.tenants)[0],
): Promise<number> {
  let added = 0;
  const companyIds = await services.tenancy.companyIdsByVat(
    db,
    tenantId,
    tenant.companies.map((c) => c.vatNumber),
  );
  const itemIds = await services.registry.itemIdsByCode(
    db,
    tenantId,
    tenant.items.map((i) => i.code),
  );
  for (const [index, spec] of tenant.orders.entries()) {
    const company = { tenantId, companyId: companyIds[index]!, userId: null };
    if (await services.orders.hasOrders(db, company.companyId)) continue;
    const warehouse = tenant.warehouse[index]!.warehouses.find((w) => w.code === spec.warehouse)!;
    const warehouseId = (await services.warehouse.ensureWarehouse(db, company, warehouse)).id;
    for (const o of spec.orders) {
      const vat = /^\d/.test(o.party) ? withCheckDigit(o.party) : o.party;
      const id = uuidv7(Date.parse(`${o.date}T08:00:00Z`));
      let current = await services.orders.createDraft(
        db,
        company,
        {
          id,
          kind: o.kind,
          orderDate: o.date,
          partyId: (await services.registry.partyIdByVat(db, tenantId, vat))!,
          warehouseId,
          partyReference: o.ref ?? null,
          requestedDate: o.requested ?? null,
          notes: o.notes ?? null,
          lines: o.lines.map(([code, quantity, unitPrice, discountPercent]) => ({
            itemId: itemIds.get(code)!,
            quantity,
            unitPrice,
            ...(discountPercent ? { discountPercent } : {}),
          })),
        },
        o.date,
      );
      added++;
      if (o.draft) continue;
      current = await services.orders.confirm(db, company, id, current.version, o.date);
      const lineOf = (code: string) => current.lines[o.lines.findIndex(([c]) => c === code)]!.id;
      for (const f of o.fulfil ?? []) {
        const fulfilmentId = uuidv7(Date.parse(`${f.date}T10:00:00Z`));
        current = await services.orders.fulfil(
          db,
          company,
          id,
          {
            id: fulfilmentId,
            documentDate: f.date,
            partyDocumentRef: f.ref ?? null,
            lines: f.lines.map(([code, quantity]) => ({ orderLineId: lineOf(code), quantity })),
          },
          f.date,
        );
        if (f.reverseOn) {
          current = await services.orders.reverseFulfilment(
            db,
            company,
            id,
            fulfilmentId,
            f.reverseOn,
          );
        }
      }
      if (o.closeOn) current = await services.orders.close(db, company, id, current.version);
      if (o.cancelOn) current = await services.orders.cancel(db, company, id, current.version);
    }
  }
  return added;
}

/** A demo order: kind, date, party (VAT number, first 10 digits if Italian), lines. */
function order(
  kind: 'PURCHASE' | 'SALES',
  date: string,
  party: string,
  lines: [code: string, quantity: string, unitPrice: string, discount?: string][],
  extra: {
    ref?: string;
    requested?: string;
    notes?: string;
    draft?: boolean;
    fulfil?: {
      date: string;
      ref?: string;
      lines: [code: string, quantity: string][];
      reverseOn?: string;
    }[];
    closeOn?: string;
    cancelOn?: string;
  } = {},
) {
  return { kind, date, party, lines, ...extra };
}

/** A demo stock document: reason, date, warehouse code, lines as [item code, quantity]. */
function doc(
  reason: CreateStockDocumentDto['reason'],
  date: string,
  warehouse: string,
  lines: [string, string][],
  extra: {
    target?: string;
    party?: string;
    ref?: string;
    refDate?: string;
    notes?: string;
    reverseOn?: string;
  } = {},
) {
  return { reason, date, warehouse, lines, ...extra };
}

function company(
  legalName: string,
  vatFirst10: string,
  legalForm: string | null,
  role: 'customer' | 'supplier' | 'both',
  extra: Partial<PartyInput> = {},
): PartyInput {
  return {
    kind: 'COMPANY',
    isCustomer: role !== 'supplier',
    isSupplier: role !== 'customer',
    legalName,
    legalForm,
    vatNumber: withCheckDigit(vatFirst10),
    ...extra,
  };
}

function good(code: string, description: string, unit: string, salePrice: string, vatCode = '22') {
  return { code, description, unit, vatCode, salePrice, stockManaged: true };
}

function service(
  code: string,
  description: string,
  unit: string,
  salePrice: string,
  vatCode: string,
) {
  return { code, description, unit, vatCode, salePrice, stockManaged: false };
}

/** Completes the first 15 characters of a made-up personal tax code with its check letter. */
function withCheckChar(first15: string): string {
  return first15 + personalTaxCodeCheckChar(first15);
}

/** Appends the Italian VAT check digit to 10 digits, so demo numbers pass validation. */
function withCheckDigit(first10: string): string {
  return first10 + italianCheckDigit(first10);
}
