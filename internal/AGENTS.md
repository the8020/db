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
  Schema change detection compares stored and candidate column and index
  descriptors the same way, so an unchanged table never requires a migration
  only because its keys arrived in another order.
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
- `evolution.ts` classifies schema changes from metadata; `checks.ts` compares
  actual owned CHECK expressions. Preview reads metadata only: no application
  COUNT, existence query or callback. SQL constraints establish compatibility
  during the actual change, without preservation scans or framework row loops.
- An optional table-file `migrate(ctx)` cleanup export is discovered by the
  SQL-free evaluator and loaded from candidate mounts before schema locks. Its
  `table`, old/target descriptors and transaction-bound Kysely `tx` permit
  selective old-schema updates/deletes. Hook changes, DDL, catalog and receipts
  share one bounded native transaction. Fresh/unchanged/known-safe changes skip
  invocation; source-code edits alone do not rerun cleanup. External effects,
  independently committed SQL and caller catalog/DDL patches are forbidden.
- Index removal, nonunique index changes and uniqueness relaxation skip cleanup.
  New/tightened uniqueness runs available cleanup before native index
  enforcement in the same transaction; a later index failure rolls back cleanup
  and DDL.
- PostgreSQL alters columns/checks in place. SQLite rebuilds only when its
  column/constraint limitations require it, copying all retained rows/columns;
  index-only changes use ordinary index DDL. No replacement-population callback,
  key-set/count validation or mandatory application-row analysis is used.
- Native conversions support numeric/boolean to text (including numeric-text
  enum membership), integer to float, and PostgreSQL strict text to integer.
  SQLite text-to-number, decimal representation changes, key/identity changes
  and other unimplemented conversions fail explicitly without clearing data.
- Exact `table.column` force consent tries cleanup/native activation first.
  After confirmed rollback of an eligible failure, only incompatible cells in
  authorized columns may use NULL or an authored literal target default. Target
  checks/uniqueness/references still apply. Missing legal repair, unsupported
  conversion, keys, invalid authority/drift, unavailable locks/SQL or
  unconfirmed rollback stop; none justifies clearing unrelated cells or
  resetting a table. There is no automatic whole-column/table-loss escalation.
- Metadata plan identity binds candidate, affected columns and allowed damage;
  rows arriving after preview remain governed by that exact scope. UI consent
  must be renewed when candidate or scope changes, without counting rows.
- Schema transactions have five-minute lifetimes and five-second engine lock
  waits. DDL/repair can scan, copy, rebuild indexes and lock rows; no fixed
  completion time is promised. Native cancellation and confirmed rollback own
  cleanup. Hooks may be retried before commit.
- Catalog v3 adds activation-bound `_8020_schema_rewrites` receipts, including
  exact repaired columns. A v2 activation upgrade commits pending candidate and
  catalog receipt together. Receipts prohibit old-schema rollback after commit;
  publication resumes the same candidate without repeated cleanup/repair.
  Committed table receipts replay before fresh plan/force consent checks, after
  locked target-hash, ownership, physical/catalog and reference validation.
  Replay returns stored routes without mutation; a catalog-only receipt does not
  certify table synchronization. Existing v2 pending attempts finish before
  catalog upgrade. Internal catalog receipts and reserved counts are excluded
  from user outcomes.

# Work Guidance

- Reuse the ordinary bounded job runtime for evaluation and keep output
  deterministic. A new schema need belongs in the shared descriptor contract,
  not an evaluator-specific runtime or application branch in Go.

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
