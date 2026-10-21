import type { IdentityService } from '../modules/identity/index.js';
import type { PartyInput, RegistryService } from '../modules/registry/index.js';
import type { TenancyService } from '../modules/tenancy/index.js';
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
  services: { tenancy: TenancyService; identity: IdentityService; registry: RegistryService },
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
    summary.push({
      slug: slug(tenant.slug),
      created,
      companies: tenant.companies.length,
      members: tenant.members.length,
      parties,
      items,
    });
  }
  return { tenants: summary, userIds: [...userIds] };
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
