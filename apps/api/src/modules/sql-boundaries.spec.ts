import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Module boundaries in SQL (docs/adr/0022, docs/conventions.md B3). dependency-cruiser checks
// imports, but cannot see the SQL a repository writes by hand. This test reads every module's
// code, finds the table names after FROM, JOIN, INTO and UPDATE, and fails when one belongs to
// another module. Tables are assigned to modules by the schema file that maps them
// (prisma/schema/<module>.prisma). Other modules' data is read through their published views
// (registry_item_refs…), which no schema file maps. A heuristic, declared as such: it reads text,
// it does not parse SQL.
const root = join(import.meta.dirname, '..', '..');
const schemaDir = join(root, 'prisma', 'schema');
const modulesDir = join(root, 'src', 'modules');

function tablesByModule(): Map<string, string> {
  const owner = new Map<string, string>();
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.prisma'))) {
    const module = file.replace(/\.prisma$/, '');
    for (const match of readFileSync(join(schemaDir, file), 'utf8').matchAll(
      /^\s*@@map\("([a-z_]+)"\)/gm,
    )) {
      owner.set(match[1]!, module);
    }
  }
  return owner;
}

function sqlTables(source: string): string[] {
  return [...source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+"?([a-z_]+)"?/g)].map((m) => m[1]!);
}

describe('module boundaries in SQL', () => {
  const owner = tablesByModule();

  it('knows the tables of every module', () => {
    expect(owner.get('items')).toBe('registry');
    expect(owner.get('stock_balances')).toBe('warehouse');
    expect(owner.has('registry_item_refs')).toBe(false);
  });

  it('never names another module’s table in hand-written SQL', () => {
    const crossings: string[] = [];
    for (const module of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!module.isDirectory()) continue;
      for (const file of readdirSync(join(modulesDir, module.name)).filter(
        (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
      )) {
        const source = readFileSync(join(modulesDir, module.name, file), 'utf8');
        for (const table of sqlTables(source)) {
          const tableOwner = owner.get(table);
          if (tableOwner && tableOwner !== module.name) {
            crossings.push(`${module.name}/${file}: ${table} (${tableOwner})`);
          }
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it('finds table names in SQL (the scan itself works)', () => {
    expect(
      sqlTables('SELECT 1 FROM stock_balances b JOIN registry_item_refs i ON true FOR UPDATE'),
    ).toEqual(['stock_balances', 'registry_item_refs']);
  });
});
