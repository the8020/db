Parent DOX: [db DOX](../AGENTS.md).

# Purpose

- Ship the package-owned Kysely and Zod dependencies as single-file bundles.

# Ownership

- `kysely.ts` and `zod.ts` pin upstream entrypoints and supply original types
  through `@deno-types`. Generated `.js` bundles and upstream license notices
  ship with this package.

# Local Contracts

- Consumers use `../kysely.ts` or `../fields.ts`. Only external dependencies
  enter these bundles; application source remains ordinary modules.
- Regenerate and commit JavaScript when changing a pin. Preserve upstream
  exports and names; do not edit generated files.

# Work Guidance

# Verification

- Run `deno task bundle`, `deno task check`, and `deno task test` from the
  package root.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
