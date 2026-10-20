const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Context values go into SQL settings: refuse anything that is not a UUID. */
export function assertUuid(value: string, name: string): void {
  if (!UUID.test(value)) throw new Error(`Invalid ${name} in database context: ${value}`);
}
