// Module boundaries, checked in CI with `pnpm check:boundaries` (docs/conventions.md B3, F11;
// docs/adr/0011). A module is a folder; what it offers to others is its index.ts, everything else
// is internal. Limit: one Prisma client serves every module, so reading another module's tables
// cannot be detected here; that rule is kept by convention (only a module's repository touches
// its models) and review.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'module-internals',
      comment:
        'A module imports another module only through its index.ts, never its internal files (B3).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'outside-into-module-internals',
      comment: 'Code outside the modules (commands, setup) uses their index.ts only.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/modules/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: '^src/modules/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'shared-knows-no-domain',
      comment:
        'shared/ and the database layer hold no domain knowledge: they never import a module (B5).',
      severity: 'error',
      from: { path: '^src/(shared|prisma|config)/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'feature-to-feature',
      comment: 'A frontend feature does not import another feature (F11).',
      severity: 'error',
      from: { path: '^src/features/([^/]+)/' },
      to: { path: '^src/features/', pathNot: '^src/features/$1/' },
    },
    {
      name: 'no-circular',
      comment: 'Circular imports make module boundaries meaningless.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import must resolve, or the rules above could silently miss it.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['\\.spec\\.tsx?$', '\\.test\\.tsx?$', '/generated/'] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
