# 0001. Modular monolith

- Status: Accepted
- Date: 2026-10-19

## Context

Mercurio covers several business areas: registry (customers, suppliers, items), warehouse, orders and
invoicing. They depend on each other (a fulfilled order produces an invoice), but each has its own
rules and data. The system is developed and run by one person on one server.

We want clear boundaries between areas, so each one can be understood, tested and changed on its own,
and could later be enabled or sold separately. We do not want the operational cost of a distributed
system.

## Decision

Mercurio is a **modular monolith**: one deployable application, one NestJS module per business area.

- Inside a module, code is layered: **controller** (HTTP only) → **service** (use cases, business
  rules, transactions) → **repository** (data access). Controllers hold no logic; services know
  nothing about HTTP.
- A module never imports another module's internal classes and never reads another module's tables.
  It talks to other modules only through an explicitly **exported public service** or through
  **domain events** (typed classes named in the past tense, e.g. `OrderFulfilledEvent`).
- Code without domain knowledge (money, pagination, errors) lives in a shared module.

Example: the orders module emits `OrderFulfilledEvent`; the invoicing module listens and creates a
draft invoice. Orders does not know that invoicing exists.

## Consequences

- One process, one database, one deployment: transactions stay local and simple, debugging is direct.
- Boundaries are enforced by convention and review, not by the network. They need discipline.
- If one area ever needs to scale or ship independently, its module already has a narrow interface
  and its own tables, so it can be extracted.
- In-process events are lost if the process stops between the commit and the handler. Where that
  matters (invoice creation), a transactional outbox is the planned evolution.

## Alternatives considered

- **Microservices**: independent deployment and scaling we do not need, at the price of network
  calls, distributed transactions and much heavier operations.
- **Unstructured monolith** (layers by technical type, shared tables): fastest at the start, but
  areas become entangled and the boundaries this project wants to show disappear.
