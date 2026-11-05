import { createRequire } from 'node:module';
import { afterEach } from 'vitest';

/**
 * Fails the test that sends a query on a connection still busy with another one (B39).
 *
 * Every request runs in one transaction, so on one connection. Prisma queues the operations of a
 * transaction (a `Promise.all` over it is safe), but not the queries of a single operation: an
 * `include` of several relations loads them side by side. pg 8 queues them with a deprecation
 * warning and pg 9 will refuse them. The warning is printed once per process and only from the
 * third query waiting, so the check looks at the connection itself.
 */
const require = createRequire(import.meta.url);
const { Client } = require('pg') as {
  Client: { prototype: { query: (...args: unknown[]) => unknown } };
};

type QueuedClient = { _queryQueue?: unknown[]; _activeQuery?: unknown };
const query = Client.prototype.query;
const overlaps: string[] = [];

Client.prototype.query = function (this: QueuedClient, ...args: unknown[]) {
  if (!Array.isArray(this._queryQueue) || !('_activeQuery' in this)) {
    // pg changed its internals: say so rather than silently stop checking.
    throw new Error(
      'serial-queries: pg no longer exposes its active query and queue, update the check',
    );
  }
  // Busy: a query is running or waiting. pg's own warning looks only at the waiting ones, so it
  // misses the second of two queries side by side.
  if (this._activeQuery != null || this._queryQueue.length > 0) {
    const [config] = args;
    const text = typeof config === 'string' ? config : (config as { text?: string })?.text;
    overlaps.push((text ?? '').replace(/\s+/g, ' ').slice(0, 200));
  }
  return query.apply(this, args);
};

afterEach(() => {
  if (overlaps.length === 0) return;
  const found = overlaps.splice(0);
  throw new Error(
    `A query was sent while the connection was busy (B39): run queries one after the other ` +
      `inside a transaction.\n${found.map((q) => `  - ${q}`).join('\n')}`,
  );
});
