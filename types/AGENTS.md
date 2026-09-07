Parent DOX: [db DOX](../AGENTS.md).

# Purpose

- Share semantic database references across administration programs.

# Ownership

- `table.ts` defines the reusable Zod table ID field.

# Local Contracts

- Value help filters the existing kernel table catalog by table/package/module
  and sends the requested batch only. The catalog API returns a complete
  snapshot.
- Open calls the public database administration program with the selected ID.
- Generic table inspection uses deployed metadata and never evaluates sources.

# Work Guidance

# Verification

- Run `deno task check` and `deno task test` from the repository root.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
