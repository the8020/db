Parent DOX: [db DOX](../AGENTS.md).

# Purpose

- Own table descriptors, logical codecs, the Kysely driver, and database command
  helpers.

# Ownership

- Own `descriptor.ts`, `values.ts`, `runtime.ts`, `commands.ts`, and colocated
  tests; root modules expose the public API.

# Local Contracts

- Share logical value encoding and decoding between Kysely and descriptor-aware
  consumers.
- Runtime calls use the package-neutral kernel bridge and receive no connection
  credentials.
- Bounded transaction scopes use the kernel-owned connection lifecycle; insert
  IDs are requested only for compiled inserts.

# Work Guidance

- Fix compiler and codec discrepancies here and kernel transport discrepancies
  in the kernel, with regression coverage at the owning layer.

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
