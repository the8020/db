Parent DOX: [db DOX](../AGENTS.md).

# Purpose

- Own table descriptors, logical codecs, the Kysely driver, and database command
  helpers.

# Ownership

- Own `schema.ts`, `descriptor.ts`, `values.ts`, `runtime.ts`, `commands.ts`,
  and colocated tests; root modules expose the public API.

# Local Contracts

- Share logical value encoding and decoding between Kysely and descriptor-aware
  consumers.
- `schema.ts` owns plain logical-type and descriptor contracts; it imports no
  runtime. `values.ts` shares decimal/enum definition validation and exact
  decimal value validation with the reusable Zod fields.
- Runtime calls use the package-neutral kernel bridge and receive no connection
  credentials.
- Decode each result using its compiled query's projection. Kysely builder
  branches can share a query ID; concurrent executions must not overwrite each
  other's codec metadata.
- Decimal parameters use bigint transport; logical precision/scale validation
  and exact scaling belong here. Nullable decimal values remain null.
- Bounded transaction scopes use the kernel-owned connection lifecycle; insert
  IDs are requested only for compiled inserts.
- `descriptor.ts` adapts ordinary Zod fields with `t.from()` and structures with
  `columns()`. Infer only unambiguous primitive storage and nullability; require
  custom value representation at its field definition and leave SQL defaults to
  the column definition. Storage survives structure imports and Zod refinements;
  column overrides cannot change a declared representation. Semantic help is
  absent from physical descriptors.
- String formats such as `z.email()`, `z.url()`, and `z.uuid()` retain text
  storage. Numeric formats such as `z.int()` and `z.float64()` retain numeric
  storage. Infer from the primitive kind, not validation format names.

# Work Guidance

- Extend shared logical definitions only when existing Zod and Kysely
  composition cannot express the need. Check all affected descriptor, codec,
  validation, and UI consumers. Connections stay native; `../internal/` owns DDL
  and schema synchronization.

- Fix compiler and codec discrepancies here and kernel transport discrepancies
  in the kernel, with regression coverage at the owning layer.

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
