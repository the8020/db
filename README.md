# 80|20 database package

`@the8020/db` defines application tables and exposes a normal Kysely database
object. The Go kernel owns database credentials, connections, physical schema,
and deployment synchronization.

Kysely is pinned and materialized in the managed Deno runtime image; package
source contains only the 80|20 layer.

## Tables

Place one definition at `tables/<name>.ts`. Its exported identifier must match
the package path after lower-casing and collapsing non-alphanumeric runs:

```ts
import { t, table } from "@the8020/db";

export default table("acme__orders__orders", {
  id: t.integer().generated().primaryKey(),
  total: t.decimal(18, 2),
  createdAt: t.datetime().defaultNow(),
});
```

Identifiers longer than 63 bytes use a deterministic hash suffix. A collision is
rejected. Column names must be portable SQL identifiers and may not be `table`,
`select`, `selectAll`, `insert`, `update`, or `delete`.

Supported logical types are text, boolean, safe integer, finite float, exact
decimal string, `Date`, `Uint8Array`, JSON, and string enum. Decimal precision
is at most 18 digits and values always use the declared fixed scale. Integers
and decimals use signed 64-bit physical columns in both engines; the runtime
limits ordinary integers to JavaScript's safe range and transports decimals as
scaled integers without exposing that representation to application code.

Composite primary keys and logical references are supported. Phase one does not
create physical foreign keys. `generated()` is limited to one integer primary
key.

## Queries

Table helpers only provide the first Kysely call:

```ts
await Orders.selectAll().where(Orders.id, "=", 10).execute();
await Orders.insert({ total: "125.50" }).execute();
await Orders.update({ total: "130.00" }).where(Orders.id, "=", 10).execute();
await Orders.delete().where(Orders.id, "=", 10).execute();
```

They return ordinary Kysely builders. `db` remains available for joins, aliases,
subqueries, CTEs, grouping, raw SQL, and explicit transactions. Direct columns
and simple aliases receive logical value conversion. Arbitrary raw or derived
expressions return the database engine's physical value; applications can
convert those explicitly.

One result is bounded by the kernel's configured row and byte limits. Exceeding
either limit throws instead of returning partial rows. Streaming is deferred;
paginate large queries.

`@the8020/db` asks the credential-free kernel metadata endpoint once when its
Worker loads, then selects Kysely's SQLite or PostgreSQL compiler. The custom
driver forwards compiled SQL and tagged values to the kernel. Transactions are
real kernel-held database transactions scoped to the current request or job;
they are rolled back on failed callbacks and execution/Worker cleanup.

## Synchronization

Local development edits affect typing only. Package installation, version
switching, pulling, and development activation evaluate the changed package's
tables in a sandbox and apply safe schema changes before code is switched. Fresh
databases synchronize every installed package before services start. Normal
boots do not scan all tables.

Removing a definition or column retires it in the database catalog and retains
its physical data. The database program can permanently trim selected retired
objects. Type changes and unsafe additions stop activation with
`migration_required`.

The evaluator receives a read-only package tree, no database execution
capability, and no direct credentials. Its batches are limited to 256 tables.

## Catalog and administration

The kernel transactionally bootstraps only `_8020_catalog`, `_8020_tables`,
`_8020_columns`, `_8020_dependencies`, and `_8020_pending_deployment`. A new
database stays uninitialized while all installed package tables are evaluated
and synchronized in resumable batches; ordinary services start only after it is
ready. Later boots validate the small catalog and skip the full scan unless an
unfinished deployment needs recovery.

The Database UUI program is database-first: it lists deployed, retired, drifted,
missing, and uncatalogued tables. Definition Changes evaluates current activated
source separately. Detail performs the full logical/physical/source comparison.
Synchronize applies only supported changes; confirmed Trim is the explicit
destructive escape hatch.

The normal safe set is missing-table creation, additive nullable or literal-
default columns, and missing ordinary/unique indexes. Removals stay physically
present and become retired. Type, primary-key, nullability, existing-default,
rename, and ambiguous constraint changes require a future migration or explicit
administrative SQL. Physical foreign keys, streaming, savepoints, and package
data seed hooks are intentionally deferred.
