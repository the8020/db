Parent DOX: [db DOX](../AGENTS.md).

# Purpose

- Expose ordinary database administrative programs for the command bus.

# Ownership

- Own hidden program manifests and entrypoints; `../src/commands.ts` owns shared
  command parsing and kernel delegation.

# Local Contracts

- Receive raw string arguments through default exports and report intentional
  input failures structurally.
- Keep physical schema operations and database readiness in the kernel.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
