import { describe, expect, it } from 'vitest';
import { EventBus, type EventContext } from './event-bus.js';

class SomethingHappenedEvent {
  constructor(readonly id: string) {}
}
class SomethingElseHappenedEvent {
  constructor(readonly id: string) {}
}

const context = {
  tx: {},
  company: { tenantId: 't', companyId: 'c', userId: null },
} as never as EventContext;

describe('EventBus', () => {
  it('calls the listeners of the event class in the order they subscribed, one after the other', async () => {
    const bus = new EventBus();
    const calls: string[] = [];
    bus.subscribe(SomethingHappenedEvent, async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push(`first ${event.id}`);
    });
    bus.subscribe(SomethingHappenedEvent, async (event) => {
      calls.push(`second ${event.id}`);
    });
    bus.subscribe(SomethingElseHappenedEvent, async () => {
      calls.push('other');
    });

    await bus.publish(new SomethingHappenedEvent('a'), context);

    expect(calls).toEqual(['first a', 'second a']);
  });

  it('passes the publisher context to the listeners', async () => {
    const bus = new EventBus();
    let seen: EventContext | undefined;
    bus.subscribe(SomethingHappenedEvent, async (_event, received) => {
      seen = received;
    });

    await bus.publish(new SomethingHappenedEvent('a'), context);

    expect(seen).toBe(context);
  });

  it('lets an error of a listener reach the publisher and stops the listeners after it', async () => {
    const bus = new EventBus();
    const calls: string[] = [];
    bus.subscribe(SomethingHappenedEvent, async () => {
      throw new Error('refused');
    });
    bus.subscribe(SomethingHappenedEvent, async () => {
      calls.push('after');
    });

    await expect(bus.publish(new SomethingHappenedEvent('a'), context)).rejects.toThrow('refused');
    expect(calls).toEqual([]);
  });

  it('does nothing for an event nobody listens to', async () => {
    await expect(
      new EventBus().publish(new SomethingHappenedEvent('a'), context),
    ).resolves.toBeUndefined();
  });
});
