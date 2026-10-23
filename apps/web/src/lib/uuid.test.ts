import { uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('has version 7, the RFC variant and the time first', () => {
    const id = uuidv7(Date.UTC(2026, 9, 23));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(Date.UTC(2026, 9, 23));
  });
});
