Parent DOX: [db DOX](../AGENTS.md).

# Purpose

- Own table evaluation, schema SQL and comparison, catalog lifecycle, and
  conservative synchronization.

# Ownership

- `evaluator.ts` imports validated table modules with no database access.
- `ddl.ts` owns logical validation, storage mappings, defaults, constraints, and
  physical comparison; it performs no database or execution operations.
- `catalog.ts` bootstraps schema metadata without depending on its own
  evaluator.
- `schema.ts` applies schema/catalog operations through ordinary native SQL and
  transactions. `schema_bridge_test.ts` connects the actual implementation to
  the native test bridge; it is not a production execution path.

# Local Contracts

- The evaluator is internal and non-discoverable; validate module paths,
  expected table identity, batch bounds, and returned descriptors.
- Descriptor validation ignores JSON object-key order across native transport,
  preserves authored array order, and verifies the evaluator's exact JSON/hash.
- Evaluation remains restricted and never gains SQL through schema application.
- Schema operations retain existing safe-addition, drift, required-column
  retirement, rollback, explicit trim, source ownership, reference, and authored
  column-order behavior. Native source publication calls prepare/complete using
  exact activation IDs; overlapping pending package claims reject.
- Catalog and physical collection reads page through ordinary SQL within the
  configured native row limit; writes batch at most 128 catalog rows.
- Ordinary catalog reads do not evaluate source or scan Git. Candidate schema
  application uses its staged package mounts; rollback evaluates active source.
- Partial first initialization resumes matching table/commit pairs; retry clears
  the prior schema failure before synchronization. Existing catalog validation
  remains read-only, including alongside a SQLite writer.

# Work Guidance

- Reuse the ordinary bounded job runtime for evaluation and keep output
  deterministic. A new schema need belongs in the shared descriptor contract,
  not an evaluator-specific runtime or application branch in Go.

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
