# Glossary

Domain terms used in the code (English) and in the Italian interface. Code always uses the English
term; the interface uses the term of the selected language.

## Platform

| Code (English)  | Italiano                    | Meaning                                                                                             |
| --------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| tenant          | cliente (della piattaforma) | A customer of Mercurio: whoever holds the subscription. Its data is invisible to every other tenant |
| company         | azienda                     | A legal entity of a tenant, with its own VAT number, invoice numbering and warehouses               |
| user / identity | utente                      | A person. One identity per email, whatever the number of tenants they work for                      |
| membership      | appartenenza                | A person's place in a tenant: role and reachable companies                                          |
| role            | ruolo                       | What a person can do in a tenant: administrator, warehouse keeper, accountant, read only            |
| module          | modulo                      | A sellable business area (registry, warehouse, orders, invoicing), enabled per tenant               |
| activation code | codice di attivazione       | One-time code a new person uses to set their password and two-factor authentication                 |
| VAT number      | partita IVA                 | Tax identifier of a company; Italian numbers have 11 digits and a check digit                       |
| tax code        | codice fiscale              | Italian tax identifier: 11 digits for companies, 16 characters for individuals                      |

## Registry

| Code (English)  | Italiano        | Meaning                                         |
| --------------- | --------------- | ----------------------------------------------- |
| customer        | cliente         | A business or person Mercurio sells to          |
| supplier        | fornitore       | A business Mercurio buys from                   |
| item            | articolo        | A product kept in stock and sold                |
| item code (SKU) | codice articolo | Unique identifier of an item                    |
| unit of measure | unità di misura | How an item is counted: pieces, kg, metres…     |
| VAT rate        | aliquota IVA    | Percentage of VAT applied to an item (e.g. 22%) |

## Warehouse

| Code (English)     | Italiano               | Meaning                                                              |
| ------------------ | ---------------------- | -------------------------------------------------------------------- |
| stock movement     | movimento di magazzino | A recorded change in quantity of an item; never edited or deleted    |
| inbound movement   | carico                 | A movement that increases stock (e.g. goods receipt)                 |
| outbound movement  | scarico                | A movement that decreases stock (e.g. shipment to a customer)        |
| adjustment         | rettifica              | A movement that aligns recorded stock with a physical count          |
| reversal           | storno                 | A movement that cancels a wrong one, instead of deleting it          |
| stock level        | giacenza               | Quantity on hand, always computed as the sum of the movements        |
| reserved quantity  | quantità impegnata     | Stock set aside for open sales orders                                |
| available quantity | disponibilità          | Stock level minus reserved quantity                                  |
| reorder threshold  | soglia di riordino     | Stock level below which an item is flagged for reordering            |
| goods receipt      | ricevimento merce      | Recording goods delivered against a purchase order, possibly in part |

## Orders

| Code (English) | Italiano                     | Meaning                                               |
| -------------- | ---------------------------- | ----------------------------------------------------- |
| purchase order | ordine fornitore             | Order placed with a supplier                          |
| sales order    | ordine cliente               | Order received from a customer                        |
| order line     | riga d'ordine                | One item, quantity and price within an order          |
| reservation    | prenotazione / impegno       | Setting stock aside for a sales order                 |
| fulfilment     | evasione                     | Shipping the goods of a sales order, possibly in part |
| delivery note  | documento di trasporto (DDT) | Document that accompanies goods shipped to a customer |

## Invoicing

| Code (English)   | Italiano          | Meaning                                                                  |
| ---------------- | ----------------- | ------------------------------------------------------------------------ |
| invoice          | fattura           | Fiscal document requesting payment from a customer                       |
| draft            | bozza             | An invoice that can still be changed; it has no fiscal number            |
| issue            | emissione         | Making an invoice final: it gets its number and can no longer change     |
| invoice number   | numero di fattura | Progressive number per year, without gaps                                |
| credit note      | nota di credito   | Document that corrects or cancels an issued invoice, in whole or in part |
| taxable amount   | imponibile        | Amount before VAT                                                        |
| VAT              | IVA               | Value-added tax                                                          |
| VAT summary      | riepilogo IVA     | Taxable amount and VAT grouped by rate                                   |
| due date         | scadenza          | Date by which a payment is expected                                      |
| payment schedule | scadenziario      | List of due dates, paid and unpaid                                       |
| payment received | incasso           | A recorded customer payment against one or more due dates                |
| SdI              | SdI               | Sistema di Interscambio: the Italian e-invoicing exchange (out of scope) |
| FatturaPA        | FatturaPA         | The Italian XML e-invoice format                                         |

## Status codes

Examples of values stored in the database and returned by the API ([G2a](conventions.md)); the
interface translates them. The list grows with the modules.

| Code               | Italiano       | Used for                    |
| ------------------ | -------------- | --------------------------- |
| `ACTIVE`           | Attivo         | Tenants, users, memberships |
| `SUSPENDED`        | Sospeso        | Tenants                     |
| `DISABLED`         | Disattivato    | Users                       |
| `REMOVED`          | Rimosso        | Memberships                 |
| `ADMIN`            | Amministratore | Roles                       |
| `WAREHOUSE_KEEPER` | Magazziniere   | Roles                       |
| `ACCOUNTANT`       | Contabile      | Roles                       |
| `READ_ONLY`        | Sola lettura   | Roles                       |
| `DRAFT`            | Bozza          | Invoices, orders            |
| `ISSUED`           | Emessa         | Invoices                    |
