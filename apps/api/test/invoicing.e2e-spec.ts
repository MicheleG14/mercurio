import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { MembershipRole, PrismaClient } from '../src/generated/prisma/client.js';
import { businessToday } from '../src/shared/dates.js';
import { italianCheckDigit } from '../src/shared/italian-identifiers.js';
import { activate, bearer, createTestApp } from './support/auth.js';
import {
  adminClient,
  createWorld,
  deleteTenantsAndUsers,
  uniqueSuffix,
  uuidv7,
  type World,
} from './support/database.js';

// Invoicing end to end (docs/adr/0027-0030): real application, real database, the API role subject
// to Row-Level Security. Tenant A has warehouse, orders and invoicing; B has none of them.
// Shipments reach invoicing as events of the orders module, in their own transaction.
describe('invoicing (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let world: World;
  const token: Record<'admin' | 'other' | MembershipRole, string> = {} as never;
  const extraUsers: string[] = [];
  const suffix = uniqueSuffix();
  const http = () => request(app.getHttpServer());
  const today = businessToday();
  const year = Number(today.slice(0, 4));
  let counter = 0;

  const newVat = () => {
    const first10 =
      (Number.parseInt(suffix, 16) % 1e6).toString().padStart(6, '5') +
      String(++counter).padStart(4, '0');
    return first10 + italianCheckDigit(first10);
  };

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    await admin.tenantModule.createMany({
      data: ['warehouse', 'orders', 'invoicing'].map((moduleKey) => ({
        tenantId: world.tenants.a,
        moduleKey,
      })),
    });
    app = await createTestApp();
    token.admin = (await activate(app, admin, world.users.u)).accessToken;
    token.admin = (
      await http()
        .post('/api/auth/tenant')
        .set(bearer(token.admin))
        .send({ tenantId: world.tenants.a })
        .expect(200)
    ).body.accessToken;
    token.ADMIN = token.admin;
    token.other = (await activate(app, admin, world.users.v)).accessToken;
    for (const role of ['WAREHOUSE_KEEPER', 'ACCOUNTANT', 'READ_ONLY'] as const) {
      const user = await admin.user.create({
        data: { email: `${role.toLowerCase()}-in-${suffix}@example.com`, name: role },
      });
      extraUsers.push(user.id);
      await admin.membership.create({
        data: { tenantId: world.tenants.a, userId: user.id, role, allCompanies: true },
      });
      token[role] = (await activate(app, admin, user.id)).accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    if (world) {
      await deleteTenantsAndUsers(admin, Object.values(world.tenants), [
        ...Object.values(world.users),
        ...extraUsers,
      ]);
    }
    await admin.$disconnect();
  });

  const as = (who: keyof typeof token, company: string | null = world.companies.a) => {
    const set = (r: request.Test) => {
      r.set(bearer(token[who]));
      return company ? r.set('X-Company-Id', company) : r;
    };
    return {
      get: (url: string) => set(http().get(`/api${url}`)),
      post: (url: string, body: object = {}) => set(http().post(`/api${url}`)).send(body),
      put: (url: string, body: object) => set(http().put(`/api${url}`)).send(body),
      delete: (url: string) => set(http().delete(`/api${url}`)),
    };
  };

  const ids = {} as Record<'customer' | 'bare' | 'warehouse' | 'service', string>;
  beforeAll(async () => {
    const customer = (extra: object) =>
      as('admin', null)
        .post('/parties', {
          kind: 'COMPANY',
          isCustomer: true,
          isSupplier: false,
          legalName: `Cliente fatture ${suffix} ${++counter} Srl`,
          vatNumber: newVat(),
          ...extra,
        })
        .expect(201);
    ids.customer = (
      await customer({
        address: 'Via Torino 12',
        postalCode: '20123',
        city: 'Milano',
        province: 'MI',
        sdiCode: 'ABC1234',
        paymentTerms: '30-60FM',
        paymentMethod: 'MP05',
      })
    ).body.id;
    ids.bare = (await customer({})).body.id;
    ids.warehouse = (
      await as('admin').post('/warehouses', { code: 'FAT', name: 'Fatture' }).expect(201)
    ).body.id;
    ids.service = (
      await as('admin', null)
        .post('/items', {
          code: `FS-${suffix}`,
          description: 'Consulenza',
          unit: 'H',
          vatCode: '22',
          salePrice: '50',
          stockManaged: false,
        })
        .expect(201)
    ).body.id;
  });

  /** A shipment of a new sales order: the event puts it among the shipments to invoice. */
  const shipped = async (lines: { quantity: string; unitPrice: string; vatCode?: string }[]) => {
    const items: string[] = [];
    for (const line of lines) {
      const item = (
        await as('admin', null)
          .post('/items', {
            code: `FI-${suffix}-${++counter}`,
            description: `Articolo ${counter}`,
            unit: 'PZ',
            vatCode: line.vatCode ?? '22',
          })
          .expect(201)
      ).body.id as string;
      await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'OPENING',
          warehouseId: ids.warehouse,
          lines: [{ itemId: item, quantity: line.quantity }],
        })
        .expect(201);
      items.push(item);
    }
    const created = await as('admin')
      .post('/orders', {
        id: uuidv7(),
        kind: 'SALES',
        partyId: ids.customer,
        warehouseId: ids.warehouse,
        lines: lines.map((line, i) => ({ itemId: items[i], ...line })),
      })
      .expect(201);
    const order = (
      await as('admin').post(`/orders/${created.body.id}/confirm`, { version: 1 }).expect(200)
    ).body;
    const fulfilmentId = uuidv7();
    await as('admin')
      .post(`/orders/${order.id}/fulfilments`, {
        id: fulfilmentId,
        lines: order.lines.map((l: { id: string; quantity: string }) => ({
          orderLineId: l.id,
          quantity: l.quantity,
        })),
      })
      .expect(201);
    return { order, fulfilmentId };
  };

  const manual = (lines: object[], extra: object = {}) =>
    as('ACCOUNTANT')
      .post('/invoice-drafts', { id: uuidv7(), partyId: ids.customer, lines, ...extra })
      .expect(201);
  const issue = (draft: { id: string; version: number }, extra: object = {}) =>
    as('ACCOUNTANT').post(`/invoice-drafts/${draft.id}/issue`, {
      version: draft.version,
      ...extra,
    });

  describe('company data', () => {
    it('refuses to issue until the company has its registered office', async () => {
      const draft = (
        await manual([{ description: 'Ore', quantity: '1', unitPrice: '10', vatCode: '22' }])
      ).body;
      const refused = await issue(draft).expect(409);
      expect(refused.body.code).toBe('COMPANY_DATA_INCOMPLETE');
      expect(refused.body.errors.map((e: { field: string }) => e.field)).toEqual([
        'address',
        'postalCode',
        'city',
        'province',
      ]);
      const company = (await as('admin').get('/companies/current').expect(200)).body;
      await as('admin')
        .put('/companies/current', {
          version: company.version,
          address: 'Via Roma 1',
          postalCode: '20121',
          city: 'Milano',
          province: 'MI',
          iban: 'IT60X0542811101000000123456',
        })
        .expect(200);
      await as('admin').delete(`/invoice-drafts/${draft.id}?version=${draft.version}`).expect(204);
    });
  });

  describe('from shipments', () => {
    it('invoices two shipments of a customer in one deferred invoice', async () => {
      const first = await shipped([{ quantity: '3', unitPrice: '12.5' }]);
      const second = await shipped([
        { quantity: '2', unitPrice: '10', vatCode: '10' },
        { quantity: '1', unitPrice: '0.25' },
      ]);
      const list = (await as('ACCOUNTANT').get(`/invoicing/to-invoice?partyId=${ids.customer}`))
        .body;
      const listed = list.items.filter((s: { fulfilmentId: string }) =>
        [first.fulfilmentId, second.fulfilmentId].includes(s.fulfilmentId),
      );
      expect(listed.map((s: { taxableAmount: string }) => s.taxableAmount)).toEqual([
        '37.50',
        '20.25',
      ]);

      const created = await as('ACCOUNTANT')
        .post('/invoice-drafts', {
          id: uuidv7(),
          fulfilmentIds: [first.fulfilmentId, second.fulfilmentId],
        })
        .expect(201);
      const draft = created.body;
      expect(draft).toMatchObject({
        partyId: ids.customer,
        paymentTerms: '30-60FM',
        taxableTotal: '57.75',
        vatTotal: '10.31', // 22% of 37.75 = 8.31, 10% of 20 = 2.00
        total: '68.06',
      });
      expect(draft.lines.map((l: { description: string }) => l.description)[0]).toMatch(
        /^DDT SC-.* – OC-/,
      );
      expect(
        draft.lines.filter((l: { fulfilmentId: string | null }) => l.fulfilmentId),
      ).toHaveLength(3);
      expect(draft.shipments).toHaveLength(2);
      expect(draft.dueDatesPreview).toHaveLength(2);

      // Taken by this draft: no other draft may take it, and the order cannot undo it.
      const taken = await as('ACCOUNTANT')
        .post('/invoice-drafts', { id: uuidv7(), fulfilmentIds: [first.fulfilmentId] })
        .expect(409);
      expect(taken.body.code).toBe('FULFILMENT_ALREADY_DRAFTED');
      const undo = await as('admin')
        .post(`/orders/${first.order.id}/fulfilments/${first.fulfilmentId}/reverse`)
        .expect(409);
      expect(undo.body.code).toBe('FULFILMENT_INVOICED');

      // The shipped quantity is fixed; the price is not.
      const fixed = await as('ACCOUNTANT')
        .put(`/invoice-drafts/${draft.id}`, {
          version: draft.version,
          lines: draft.lines.map((l: Record<string, unknown>, i: number) =>
            i === 1 ? { ...pick(l), quantity: '2' } : pick(l),
          ),
        })
        .expect(400);
      expect(fixed.body.errors).toEqual([
        expect.objectContaining({
          field: 'lines[1].quantity',
          code: 'FULFILMENT_LINE_QUANTITY_FIXED',
        }),
      ]);

      const invoice = (await issue(draft).expect(201)).body;
      expect(invoice).toMatchObject({
        kind: 'INVOICE',
        series: 'FT',
        year,
        total: '68.06',
        stampDuty: '0.00',
        paymentStatus: 'UNPAID',
        language: 'it',
        iban: 'IT60X0542811101000000123456',
      });
      expect(invoice.customer).toMatchObject({ city: 'Milano', sdiCode: 'ABC1234' });
      expect(invoice.seller).toMatchObject({ address: 'Via Roma 1' });
      expect(invoice.dueDates.map((d: { amount: string }) => d.amount)).toEqual(['34.03', '34.03']);
      expect(invoice.shipments).toHaveLength(2);
      await as('ACCOUNTANT').get(`/invoice-drafts/${draft.id}`).expect(404);
      // A second click on Issue finds the invoice.
      const again = await issue(draft).expect(200);
      expect(again.body.number).toBe(invoice.number);

      const after = (await as('ACCOUNTANT').get(`/invoicing/to-invoice?partyId=${ids.customer}`))
        .body;
      expect(
        after.items.some((s: { fulfilmentId: string }) => s.fulfilmentId === first.fulfilmentId),
      ).toBe(false);
      const stillRefused = await as('admin')
        .post(`/orders/${first.order.id}/fulfilments/${first.fulfilmentId}/reverse`)
        .expect(409);
      expect(stillRefused.body.code).toBe('FULFILMENT_INVOICED');
    });

    it('lets a shipment go back to invoice when its draft is deleted, and then be undone', async () => {
      const shipment = await shipped([{ quantity: '1', unitPrice: '5' }]);
      const draft = (
        await as('ACCOUNTANT')
          .post('/invoice-drafts', { id: uuidv7(), fulfilmentIds: [shipment.fulfilmentId] })
          .expect(201)
      ).body;
      await as('ACCOUNTANT')
        .delete(`/invoice-drafts/${draft.id}?version=${draft.version}`)
        .expect(204);
      await as('admin')
        .post(`/orders/${shipment.order.id}/fulfilments/${shipment.fulfilmentId}/reverse`)
        .expect(200);
      const gone = await as('ACCOUNTANT')
        .post('/invoice-drafts', { id: uuidv7(), fulfilmentIds: [shipment.fulfilmentId] })
        .expect(404);
      expect(gone.body.code).toBe('FULFILMENT_NOT_FOUND');
    });
  });

  describe('by hand', () => {
    it('invoices a service, a free line and a line of text, with the stamp duty when due', async () => {
      const draft = (
        await manual(
          [
            { itemId: ids.service, quantity: '2' },
            { description: 'Note di consegna' },
            { description: 'Formazione esente', quantity: '1', unitPrice: '80', vatCode: 'N4' },
          ].map((line, i) => (i === 0 ? { ...line, unitPrice: '50' } : line)),
          { paymentTerms: 'RD' },
        )
      ).body;
      expect(draft).toMatchObject({ stampDutyRequired: true, total: '202.00' });
      const withStamp = (
        await as('ACCOUNTANT')
          .put(`/invoice-drafts/${draft.id}`, {
            version: draft.version,
            partyId: ids.customer,
            paymentTerms: 'RD',
            lines: [...draft.lines.map(pick), { stampDutyCharge: true }],
          })
          .expect(200)
      ).body;
      expect(withStamp.lines.at(-1)).toMatchObject({
        description: 'Rivalsa imposta di bollo',
        vatNature: 'N1',
        lineAmount: '2.00',
      });
      const invoice = (await issue(withStamp).expect(201)).body;
      expect(invoice).toMatchObject({ stampDuty: '2.00', total: '204.00' });
      expect(invoice.dueDates).toEqual([
        expect.objectContaining({ dueDate: today, amount: '204.00' }),
      ]);
    });

    it('requires prices and the data of the customer to issue', async () => {
      const unpriced = (await manual([{ itemId: ids.service, quantity: '1', unitPrice: null }]))
        .body;
      const refused = await issue(unpriced).expect(400);
      expect(refused.body.errors).toEqual([
        expect.objectContaining({ field: 'lines[0].unitPrice', code: 'REQUIRED' }),
      ]);
      const bare = (
        await manual([{ itemId: ids.service, quantity: '1', unitPrice: '1' }], {
          partyId: ids.bare,
        })
      ).body;
      const incomplete = await issue(bare).expect(409);
      expect(incomplete.body.code).toBe('CUSTOMER_DATA_INCOMPLETE');
      expect(incomplete.body.errors.map((e: { field: string }) => e.field)).toEqual([
        'address',
        'city',
        'postalCode',
        'sdiCode',
      ]);
    });

    it('keeps numbers and dates growing together', async () => {
      const draft = (await manual([{ itemId: ids.service, quantity: '1', unitPrice: '1' }])).body;
      const future = await issue(draft, { issueDate: '2999-01-01' }).expect(400);
      expect(future.body.errors[0].code).toBe('DATE_IN_FUTURE');
      const yesterday = new Date(`${today}T00:00:00Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const before = await issue(draft, { issueDate: yesterday.toISOString().slice(0, 10) }).expect(
        400,
      );
      expect(before.body.errors[0].code).toBe('ISSUE_DATE_BEFORE_LAST');
    });
  });

  describe('concurrency', () => {
    it('numbers ten invoices issued at the same time without gaps or doubles', async () => {
      const drafts = [];
      for (let i = 0; i < 10; i++) {
        drafts.push((await manual([{ itemId: ids.service, quantity: '1', unitPrice: '1' }])).body);
      }
      const results = await Promise.all(drafts.map((draft) => issue(draft)));
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
      const numbers = results.map((r) => r.body.number as number).sort((a, b) => a - b);
      expect(numbers).toEqual(numbers.map((_, i) => numbers[0]! + i));
    });

    it('issues one document for two clicks at the same time', async () => {
      const draft = (await manual([{ itemId: ids.service, quantity: '1', unitPrice: '1' }])).body;
      const results = await Promise.all([issue(draft), issue(draft)]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 201]);
      expect(results[0]!.body.number).toBe(results[1]!.body.number);
    });
  });

  describe('credit notes', () => {
    it('credits part of an invoice, then the rest, never more', async () => {
      const draft = (
        await manual(
          [
            { itemId: ids.service, quantity: '2', unitPrice: '50' },
            { description: 'Trasferta', quantity: '1', unitPrice: '20', vatCode: '22' },
          ],
          { paymentTerms: '30-60DF' },
        )
      ).body;
      const invoice = (await issue(draft).expect(201)).body;
      expect(invoice.total).toBe('146.40');

      const partial = (
        await as('ACCOUNTANT')
          .post(`/invoices/${invoice.id}/credit-note`, {
            id: uuidv7(),
            lineIds: [invoice.lines[1].id],
          })
          .expect(201)
      ).body;
      expect(partial).toMatchObject({ kind: 'CREDIT_NOTE', total: '24.40' });
      expect(partial.creditedInvoice).toMatchObject({ id: invoice.id });
      const note = (await issue(partial).expect(201)).body;
      expect(note).toMatchObject({ series: 'NC', paymentStatus: 'SETTLED', dueDates: [] });

      const credited = (await as('ACCOUNTANT').get(`/invoices/${invoice.id}`).expect(200)).body;
      expect(credited.openAmount).toBe('122.00');
      // From the last instalment back: 73.20 - 24.40.
      expect(credited.dueDates.map((d: { openAmount: string }) => d.openAmount)).toEqual([
        '73.20',
        '48.80',
      ]);
      expect(credited.creditableTotal).toBe('122.00');
      expect(credited.creditNotes).toEqual([expect.objectContaining({ id: note.id })]);

      // Crediting the same line again: nothing left of it.
      const over = await as('ACCOUNTANT')
        .post(`/invoices/${invoice.id}/credit-note`, {
          id: uuidv7(),
          lineIds: [invoice.lines[1].id],
        })
        .expect(409);
      expect(over.body.code).toBe('NOTHING_TO_CREDIT');

      const rest = (
        await as('ACCOUNTANT')
          .post(`/invoices/${invoice.id}/credit-note`, { id: uuidv7() })
          .expect(201)
      ).body;
      expect(rest.total).toBe('122.00');
      const tooMuch = await as('ACCOUNTANT')
        .put(`/invoice-drafts/${rest.id}`, {
          version: rest.version,
          partyId: ids.customer,
          lines: rest.lines.map((l: Record<string, unknown>) =>
            l.creditedLineId ? { ...pick(l), quantity: '3' } : pick(l),
          ),
        })
        .expect(400);
      expect(tooMuch.body.errors[0].code).toBe('CREDIT_OVER_INVOICED');
      await issue(rest).expect(201);
      const cancelled = (await as('ACCOUNTANT').get(`/invoices/${invoice.id}`).expect(200)).body;
      expect(cancelled).toMatchObject({ paymentStatus: 'CREDITED', openAmount: '0.00' });

      const ofNote = await as('ACCOUNTANT')
        .post(`/invoices/${note.id}/credit-note`, { id: uuidv7() })
        .expect(409);
      expect(ofNote.body.code).toBe('NOT_AN_INVOICE');
    });
  });

  describe('lists and access', () => {
    it('lists issued documents with what is open', async () => {
      const page = (await as('READ_ONLY').get('/invoices?kind=INVOICE&pageSize=100').expect(200))
        .body;
      expect(page.total).toBeGreaterThan(10);
      expect(page.items[0]).toMatchObject({ kind: 'INVOICE', partyName: expect.any(String) });
      expect(
        page.items.some((i: { paymentStatus: string }) => i.paymentStatus === 'CREDITED'),
      ).toBe(true);
    });

    it('follows the permission matrix and the modules of the tenant', async () => {
      await as('WAREHOUSE_KEEPER').get('/invoices').expect(403);
      await as('READ_ONLY').post('/invoice-drafts', { id: uuidv7() }).expect(403);
      const res = await as('other', world.companies.b).get('/invoices').expect(403);
      expect(res.body.code).toBe('MODULE_NOT_ENABLED');
    });

    it('records each action in the audit log', async () => {
      const types = (
        await admin.auditEvent.findMany({
          where: { tenantId: world.tenants.a, type: { startsWith: 'INVOICE' } },
        })
      ).map((e) => e.type);
      expect(new Set(types)).toEqual(
        new Set([
          'INVOICE_DRAFT_CREATED',
          'INVOICE_DRAFT_UPDATED',
          'INVOICE_DRAFT_DELETED',
          'INVOICE_ISSUED',
        ]),
      );
      const notes = await admin.auditEvent.count({
        where: { tenantId: world.tenants.a, type: 'CREDIT_NOTE_ISSUED' },
      });
      expect(notes).toBe(2);
    });
  });

  describe('payments', () => {
    const invoiced = async (total: '122.00' | '61.00', terms = '30-60DF') => {
      const draft = (
        await manual(
          [
            {
              description: 'Servizio',
              quantity: '1',
              unitPrice: total === '122.00' ? '100' : '50',
              vatCode: '22',
            },
          ],
          { paymentTerms: terms },
        )
      ).body;
      return (await issue(draft).expect(201)).body;
    };
    const pay = (dueDates: { id: string; amount: string }[], extra: object = {}) =>
      as('ACCOUNTANT').post('/payments', {
        id: uuidv7(),
        partyId: ids.customer,
        amount: dueDates
          .reduce((sum, d) => sum + Math.round(Number(d.amount) * 100), 0)
          .toString()
          .replace(/(\d\d)$/, '.$1'),
        method: 'MP05',
        allocations: dueDates.map((d) => ({ dueDateId: d.id, amount: d.amount })),
        ...extra,
      });

    it('settles due dates in part, and opens them again when undone', async () => {
      const invoice = await invoiced('122.00');
      const [first, second] = invoice.dueDates;
      const body = {
        id: uuidv7(),
        partyId: ids.customer,
        amount: '80.00',
        method: 'MP05',
        reference: 'CRO 123',
        allocations: [
          { dueDateId: first.id, amount: '61.00' },
          { dueDateId: second.id, amount: '19.00' },
        ],
      };
      const payment = (await as('ACCOUNTANT').post('/payments', body).expect(201)).body;
      expect(payment.allocations.map((a: { reference: string }) => a.reference)).toEqual([
        invoice.reference,
        invoice.reference,
      ]);
      await as('ACCOUNTANT').post('/payments', body).expect(200);
      const partial = (await as('ACCOUNTANT').get(`/invoices/${invoice.id}`)).body;
      expect(partial).toMatchObject({ paymentStatus: 'PARTIAL', openAmount: '42.00' });

      const over = await pay([{ id: second.id, amount: '42.01' }]).expect(400);
      expect(over.body.errors[0]).toMatchObject({ code: 'ALLOCATION_OVER_DUE' });
      const mismatch = await pay([{ id: second.id, amount: '1.00' }], { amount: '2.00' }).expect(
        400,
      );
      expect(mismatch.body.errors[0]).toMatchObject({ code: 'ALLOCATION_MISMATCH' });
      const other = await pay([{ id: second.id, amount: '1.00' }], { partyId: ids.bare }).expect(
        400,
      );
      expect(other.body.errors[0]).toMatchObject({ code: 'DUE_DATE_NOT_FOUND' });

      const undone = (await as('ACCOUNTANT').post(`/payments/${payment.id}/reverse`).expect(200))
        .body;
      expect(undone.reversedById).toEqual(expect.any(String));
      const again = await as('ACCOUNTANT').post(`/payments/${payment.id}/reverse`).expect(409);
      expect(again.body.code).toBe('PAYMENT_ALREADY_REVERSED');
      const open = (await as('ACCOUNTANT').get(`/invoices/${invoice.id}`)).body;
      expect(open).toMatchObject({ paymentStatus: 'UNPAID', openAmount: '122.00' });

      await pay([
        { id: first.id, amount: '61.00' },
        { id: second.id, amount: '61.00' },
      ]).expect(201);
      expect((await as('ACCOUNTANT').get(`/invoices/${invoice.id}`)).body.paymentStatus).toBe(
        'PAID',
      );
    });

    it('never settles a due date twice when two payments arrive at the same time', async () => {
      const invoice = await invoiced('61.00', 'RD');
      const [due] = invoice.dueDates;
      const results = await Promise.all([
        pay([{ id: due.id, amount: '61.00' }]),
        pay([{ id: due.id, amount: '61.00' }]),
      ]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 400]);
    });

    it('owes the customer what a credit note gives back beyond what was open, until refunded', async () => {
      const invoice = await invoiced('61.00', 'RD');
      await pay([{ id: invoice.dueDates[0].id, amount: '61.00' }]).expect(201);
      const draft = (
        await as('ACCOUNTANT')
          .post(`/invoices/${invoice.id}/credit-note`, { id: uuidv7() })
          .expect(201)
      ).body;
      const note = (await issue(draft).expect(201)).body;
      expect(note).toMatchObject({ paymentStatus: 'REFUND_DUE', openAmount: '61.00' });
      const wrongKind = await pay([{ id: note.dueDates[0].id, amount: '61.00' }]).expect(400);
      expect(wrongKind.body.errors[0]).toMatchObject({ code: 'DUE_DATE_WRONG_KIND' });
      await pay([{ id: note.dueDates[0].id, amount: '61.00' }], { kind: 'REFUND' }).expect(201);
      expect((await as('ACCOUNTANT').get(`/invoices/${note.id}`)).body.paymentStatus).toBe(
        'REFUNDED',
      );
    });

    it('lists the payment schedule with its totals, and the overview', async () => {
      const page = (
        await as('READ_ONLY')
          .get(`/invoicing/due-dates?status=open&partyId=${ids.customer}&pageSize=100`)
          .expect(200)
      ).body;
      expect(page.items.every((d: { openAmount: string }) => d.openAmount !== '0.00')).toBe(true);
      const sum = page.items.reduce(
        (total: number, d: { kind: string; openAmount: string }) =>
          total + (d.kind === 'CREDIT_NOTE' ? -1 : 1) * Math.round(Number(d.openAmount) * 100),
        0,
      );
      expect(Math.round(Number(page.openTotal) * 100)).toBe(sum);
      const summary = (await as('READ_ONLY').get('/invoicing/summary').expect(200)).body;
      expect(summary).toMatchObject({ toInvoice: expect.any(Number), drafts: expect.any(Number) });
      expect(Number(summary.invoicedThisMonth)).toBeGreaterThan(0);
      await as('READ_ONLY').post('/payments', {}).expect(403);
    });

    it('leaves every due date settled by exactly its payments and credit notes', async () => {
      const differences = await admin.$queryRaw<unknown[]>`
        SELECT d.id FROM invoice_due_dates d
        WHERE d.tenant_id = ${world.tenants.a}::uuid
          AND d.settled_amount <> coalesce((SELECT sum(amount) FROM payment_allocations
                                            WHERE due_date_id = d.id), 0)
                                 + coalesce((SELECT sum(amount) FROM credit_allocations
                                            WHERE due_date_id = d.id), 0)`;
      expect(differences).toEqual([]);
    });
  });
});

/** A line of a draft as the API returned it, sent back as it is. */
function pick(line: Record<string, unknown>) {
  const fields = [
    'itemId',
    'description',
    'quantity',
    'unitPrice',
    'discountPercent',
    'vatCode',
    'fulfilmentId',
    'orderLineId',
    'creditedLineId',
    'stampDutyCharge',
  ];
  return Object.fromEntries(fields.map((f) => [f, line[f]]).filter(([, v]) => v !== null));
}
