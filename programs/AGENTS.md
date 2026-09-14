Parent DOX: [db DOX](../AGENTS.md).

# Purpose

- Expose ordinary database administrative programs for the command bus.

# Ownership

- Own hidden program manifests and entrypoints; `../src/commands.ts` owns shared
  command parsing and kernel delegation.

# Local Contracts

- Receive raw string arguments through default exports and report intentional
  input failures structurally.
- Administrative schema calls delegate to `../internal/schema.ts` through the
  native operation adapter. Raw SQL, connections, and transaction cleanup remain
  native and independent of schema-package availability.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
