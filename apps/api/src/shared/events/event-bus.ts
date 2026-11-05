import { Injectable, Module } from '@nestjs/common';
import type { CompanyContext, TenantTransaction } from '../../prisma/index.js';

/** Where an event happened: the transaction of the use case that publishes it, and its company. */
export interface EventContext {
  tx: TenantTransaction;
  company: CompanyContext;
}

/** What listens to an event: it works in the publisher's transaction and may throw to refuse. */
export type EventListener<E> = (event: E, context: EventContext) => Promise<void>;

/** An event class: named in the past tense (`OrderFulfilledEvent`), owned by the module that publishes it. */
type EventClass<E> = abstract new (...args: never[]) => E;

/**
 * Events between modules (B4, docs/adr/0027): published in-process, **inside the publisher's
 * transaction**. Listeners are called one after the other, in the order they subscribed, and
 * awaited; a listener that throws makes the publisher fail with it, so what the event reports and
 * what listeners record commit or roll back together. A listener may therefore refuse (an
 * invoiced shipment cannot be undone), and must be idempotent on the id of the fact, since the
 * same event can be published again (`republish-fulfilments`).
 *
 * The publisher knows only the event, never who listens: the dependency goes from the listener's
 * module to the publisher's, as with a public service.
 *
 * @example
 * bus.subscribe(OrderFulfilledEvent, (event, { tx, company }) => this.record(tx, company, event));
 * await bus.publish(new OrderFulfilledEvent(...), { tx, company });
 */
@Injectable()
export class EventBus {
  private readonly listeners = new Map<EventClass<unknown>, EventListener<never>[]>();

  subscribe<E>(type: EventClass<E>, listener: EventListener<E>): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener as EventListener<never>);
    this.listeners.set(type, list);
  }

  async publish<E extends object>(event: E, context: EventContext): Promise<void> {
    const list = (this.listeners.get(event.constructor as EventClass<E>) ??
      []) as EventListener<E>[];
    for (const listener of list) await listener(event, context);
  }
}

/**
 * Imported by every module that publishes or listens: Nest builds a module once, so they all get
 * the same bus.
 */
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
