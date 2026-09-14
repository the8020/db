# 80|20 database package

`/p/the8020/db/mod.ts` defines application tables and exposes a normal Kysely
database object. This package owns logical values, schema SQL, synchronization,
and catalog metadata. The Go kernel owns credentials, connections, bounded SQL,
transactions, and native source publication.

The db package pins Kysely in `kysely.ts` and shared Zod in `fields.ts`.
Ordinary package imports load them through the native Deno cache; neither
library is bundled into the kernel image.

## Tables

Place one definition at `tables/<name>.ts`. Its exported identifier must match
the package path after lower-casing and collapsing non-alphanumeric runs:

```ts
import { t, table } from "/p/the8020/db/mod.ts";

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

## Reusable fields and structures

A field is an ordinary Zod schema with reusable meaning. A structure is an
ordinary Zod object. Define them in the package that owns that meaning, commonly
in `types/`; import them directly wherever needed.

```ts
import { field, z } from "/p/the8020/db/fields.ts";

export const owner = field(z.string(), {
  label: "Owner",
  description: "The person responsible for this work.",
});
export const assignment = z.object({ owner, enabled: z.boolean() });
```

The same schema works in a form, as `assignment.array()` in a list, and as table
columns:

```ts
import { columns, t, table } from "/p/the8020/db/mod.ts";
import { assignment, owner } from "../types/assignment.ts";

export default table("acme__work__assignments", {
  ...columns(assignment),
  owner: t.from(owner).primaryKey(),
  enabled: t.from(assignment.shape.enabled).default(true),
});
```

`t.from()` and `columns()` preserve a field's declared storage. Without a
storage declaration they infer common primitives: strings (including email/URL/
UUID formats), booleans, integer/float numbers, dates, string enums, and
nullable wrappers.

Exact decimals and monetary amounts define their validation and storage once:

```ts
import { decimal, field, money, z } from "/p/the8020/db/fields.ts";
import { columns, t, table } from "/p/the8020/db/mod.ts";

export const unitPrice = field(money(), { label: "Unit price" });
export const line = z.object({
  quantity: decimal(12, 3),
  unitPrice,
});

export default table("acme__orders__lines", {
  id: t.integer().generated().primaryKey(),
  ...columns(line),
});
```

`decimal(precision, scale)` and `money(precision = 18, scale = 2)` are ordinary
Zod string schemas. They validate exact canonical values such as `"125.50"`
using the database codec; they never round or convert through floating point.
Money represents an amount, with currency in a separate field when needed.
Precision is 1–18 and scale is 0–precision. Nullable wrappers, `.refine()`,
clones, field customization, and structure composition retain the storage type.
UUI preserves exact strings in forms/help and compares decimal list values
without losing precision.

Custom fields use the same storage contract, for example:

```ts
export const metadata = field(z.object({ source: z.string() }), {
  storage: { type: "json" },
});
// A table can include this field with t.from(metadata) or columns(structure).
```

Storage is a typed, immutable part of the field definition. A conflicting field
or column override fails instead of silently turning money into text or changing
its precision. A transform that replaces the schema requires storage to be
declared on its resulting field; the adapter does not guess across transforms.
The explicit `t.from(schema, storage)` form remains available for unannotated
schemas, but reusable fields should declare their representation at the source.

SQL defaults, keys, and generation belong to each table. Zod optional/default/
catch wrappers do not define SQL defaults: adapt the underlying field and choose
`default()` or `nullable()` explicitly. Zod refinements validate application
values; they do not become database constraints or run automatically on Kysely
queries. The database codec still enforces the selected logical storage type.

Field metadata accepts `label`, a Markdown `description`,
`valueHelp({ query, offset, limit })`, and `open(value)`. Value help returns
`{ items: [{ value, label, description? }], more }`; query and paginate at the
source instead of loading all possible values. Callbacks run only when a
consumer invokes them. Keep their imports lazy when they need database or UUI
code, so table evaluation remains free of queries and UI initialization. The
users package's `types/user.ts` provides a concrete example.

`field()` returns a fresh schema, so local names and help can be overridden
without changing other uses. Nullable, optional, default, catch, and read-only
wrappers preserve meaning. Define validation before attaching metadata, as with
Zod's own metadata API. UUI adds presentation options through its existing
`field()` helper; these remain separate from the database descriptor.

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

The kernel injects the non-secret backend name before the Worker imports
`/p/the8020/db/mod.ts`, which selects Kysely's SQLite or PostgreSQL compiler
synchronously. The custom driver forwards compiled SQL and tagged values to the
kernel. Transactions are real kernel-held database transactions scoped to the
current request or job; they are rolled back on failed callbacks and
execution/Worker cleanup.

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

Schema application runs separately through the ordinary native SQL/transaction
bridge. Decimal parameters cross that bridge as scaled bigint values; logical
precision and scale stay in this package.

The evaluator receives a read-only package tree, no database execution
capability, and no direct credentials. Its batches are limited to 256 tables.

## Catalog and administration

The db package transactionally bootstraps `_8020_catalog`, `_8020_tables`,
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
