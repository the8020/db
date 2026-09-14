Parent DOX: [8020 workspace](../AGENTS.md).

Framework source:
[agent0ai/dox/AGENTS.md](https://github.com/agent0ai/dox/blob/765ae4ac02cc884eefcd41a3d0f71941721adb89/AGENTS.md).

# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable
  docs must stay understandable from the nearest applicable AGENTS.md plus every
  parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path,
   read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide
   rules
7. If docs conflict, the closer doc controls local work details, but no child
   doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session
before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or
  quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child
index changes. Update child docs when parent changes alter local rules. Remove
stale or contradictory text immediately. Small edits that do not change behavior
or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences,
  durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX
  Index
- Each parent explains what its direct children cover and what stays owned by
  the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own
  purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user
  instructions; if there are no specific standards or instructions yet, leave it
  empty
- Verification must reflect an existing check; if no verification framework
  exists yet, leave it empty and update it when one exists

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local
  version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for
  risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the
relevant child AGENTS.md

- Keep Kysely as the database query API, with its ordinary builders and types.
  Zod integration is an optional adapter into the existing table definitions; it
  must not replace Kysely or introduce a competing query language.
- Shared fields must carry their value representation into database structures
  without repeated storage declarations. Keep the type system systematic and
  small; custom types use the same field contract as built-in helpers.

## Child DOX Index

This root retains repository-wide contracts and files outside the child scopes
below.

- [cbus/AGENTS.md](cbus/AGENTS.md): Declare the public `db.*` and `db.tables.*`
  administrative commands.
- [internal/AGENTS.md](internal/AGENTS.md): Evaluate table modules and own
  schema validation, SQL compilation, synchronization, and catalog metadata.
- [programs/AGENTS.md](programs/AGENTS.md): Expose ordinary database
  administrative programs for the command bus.
- [src/AGENTS.md](src/AGENTS.md): Own table descriptors, logical codecs, the
  Kysely driver, and database command helpers.
- [types/AGENTS.md](types/AGENTS.md): Share database table references for
  searchable lookup and linked administration.

# Purpose

- Provide the package-defined 80|20 database schema DSL, Kysely runtime driver,
  shared semantic Zod fields, and sandboxed table evaluator.
- This file is the root contract of the independent `the8020/db` repository.

# Ownership

- Own authored TypeScript table descriptors, logical value codecs,
  administrative command programs, the application-facing `/p/the8020/db/mod.ts`
  API, the restricted evaluator, and schema/catalog operations.
- Own logical descriptor validation, physical storage mappings, DDL and
  constraint generation, conservative schema comparison/synchronization,
  retirement/trim, catalog bootstrap, and schema deployment metadata.
- The kernel owns credentials, drivers, pools, bounded SQL, transaction
  lifetimes, confined source evaluation, native publication locks, and service
  admission. Package activation coordinates source publication with schema
  preparation.

# Local Contracts

- This package owns the Zod pin in `fields.ts` and the Kysely pin/export in
  `kysely.ts`. Consumers use these package modules; the kernel image supplies no
  aliases, bundles, dependency types, or versions for either library. Shared
  fields remain usable without constructing the database runtime.

- Table modules at `packages/<namespace>/<package>/tables/<table>.ts` are the
  only authored schema source and default-export one `table()` object whose ID
  matches its normalized path.
- Logical values are encoded before the SQL bridge. Decimal strings become
  signed scaled integers using the existing bigint transport; precision, scale,
  enums, references, and logical constraints never require native
  interpretation.
- `internal/schema.ts` runs as an ordinary authorized job, separate from the
  evaluator's restricted Worker. It owns `_8020_*` schema metadata and publishes
  readiness; kernel raw SQL and administrative execution remain available when
  this package cannot initialize. Existing catalogs are validated without
  writes.
- Schema mutations recheck physical state inside native transactions. SQLite
  acquires its writer through the catalog row before inspection; PostgreSQL uses
  transaction advisory lock `802020260901`, shared with native publication.
  Native requests identify an already-held publication lock to avoid reacquiring
  it through another connection. No schema transaction spans table imports,
  hooks, or filesystem writes. Catalog rows are inserted in batches of at most
  128 through ordinary SQL.
- Logical types are deliberately limited to text, boolean, safe integer, finite
  float, scaled decimal string, datetime, bytes, JSON, and string enum.
- `fields.ts` is the runtime-independent semantic field API.
  `field(schema,
  metadata)` returns an independent ordinary Zod schema with a
  label, Markdown description, optional paged value-help callback, and optional
  entity-opening callback. Callbacks stay in the Worker and never enter database
  descriptors. Apply validation constraints before attaching field metadata;
  optional, nullable, default, catch, and read-only wrappers preserve it.
- `ValueHelpRequest` carries the ordinary `ListQuery` (search, column filters,
  and sort), offset, and limit. `ValueHelpPage` returns an ordinary Zod object
  schema in display order, rows, `more`, and optional matching/unfiltered totals
  (`totalItems`/`totalSourceItems`). Its first field is the selection key; later
  fields use standard semantic types, labels, and descriptions. Schema and
  callbacks stay server-side; UUI owns browser presentation.
- `lookup.ts` owns `lookupPage(schema, selectedQuery, request)` for SQL lookups
  over selected text/enum/boolean columns. Apply search, typed column filters,
  and sort before bounded paging; return the matching count. Other field types
  require their provider's query implementation. Do not load whole database
  tables to filter or sort lookup results.
- `choiceHelp(schema, items)` in `fields.ts` builds a paged provider for known
  scalar values or value/name pairs. It lazily reuses UUI's ordinary list query
  implementation, performs no query on import, and adds no field validation or
  storage restriction. Domain packages own the choices.
- Optional `storage` metadata defines a field's SQL value representation once,
  checked against its Zod output type. It is immutable data on the cloned Zod
  definition, retained by refinements, clones, field customization, wrappers,
  and structure composition. Presentation metadata keeps Zod registry semantics.
  Transforms that replace a schema require a new explicit storage declaration.
- `decimal(precision, scale)` and `money(precision = 18, scale = 2)` return
  ordinary Zod string schemas using the same exact-decimal validator and limits
  as the SQL codec. Money is an amount; currency stays application-owned.
- Structures are ordinary `z.object()` schemas composed through `.shape`,
  `.pick()`, `.extend()`, and `.array()`; there is no structure registry or
  required file location.
- `t.from(schema)` infers common SQL logical types. `columns(structure)` adapts
  a Zod object for table includes. Keys, SQL defaults, and generation remain
  explicit column operations. Declared field storage takes precedence over
  primitive inference; contradictory per-column overrides fail. Zod
  optional/default/catch wrappers require an explicit SQL decision. Ambiguous
  representations require `storage` at the field definition. Validation
  refinements remain Zod rules, not DDL.
- `codecs.ts` exposes the same descriptor-aware result decoding used by the
  Kysely runtime to trusted consumers of the raw kernel database API.
- Table helpers return ordinary Kysely builders after the first call. Direct
  Kysely use remains available through `db`.
- Runtime database calls use the package-neutral `@the8020/kernel` bridge and
  never receive backend credentials. The non-secret backend name is injected
  before module import so compiler selection performs no bootstrap callback.
- `transaction({timeoutMs?, lockTimeoutMs?}, callback)` supplies a normal Kysely
  transaction with bounded kernel acquisition/lifetime and engine lock waits.
  Its temporary driver owns no connections or credentials and always closes.
- Kysely dialect compilation and logical-value codecs are shared ownership of
  this package; kernel transport and engine-native decoding are shared ownership
  of the kernel database layer. Never add package-program or service-specific
  SQL workarounds for a discrepancy in either shared contract.
- The Kysely driver explicitly requests connection insert IDs only for compiled
  insert queries; other mutations never expose a stale engine-local value.
- `internal/evaluator.ts` is a bounded job entrypoint, not a discoverable UUI
  program. It imports validated table modules and returns deterministic plain
  descriptors.
- `deno.json` contains deployed runtime mappings. Package-local checks and tests
  override them with `deno.local.json` as an import map so sibling source
  repositories resolve locally without replacing compiler options.
- Flat `cbus/commands/*.toml` declarations use a required `command` field for
  the complete public name; filenames are arbitrary. They map visible `db.*` and
  `db.tables.*` commands to non-discoverable ordinary programs whose default
  exports parse raw string arguments, report intentional input errors
  structurally, and use typed kernel database operations.

# Work Guidance

- Build only what the request and established contracts require. Before adding a
  mechanism, identify that need and why existing owners or standard tools cannot
  meet it. Do not invent stronger guarantees for hypothetical cases. Remove
  unsupported additions at closeout; agent-written tests and DOX do not
  authorize them. Preserve required correctness, security, and data integrity.

- Reuse ordinary Zod and Kysely composition before adding a database concept. A
  necessary extension must work across validation, storage, and UUI consumers
  without turning one application need into unrelated driver behavior.
- Keep logical schemas and codecs in this package and physical database
  authority in the kernel. Change the kernel only for a necessary foundation
  gap, with regression evidence at the owning boundary and the affected package
  path.

- Keep the DSL and remote driver small. Prefer Kysely's compiler and builders
  over custom query syntax or expression parsing.
- Keep rare engine-native/raw expression results explicit rather than adding a
  complete runtime SQL type interpreter.

# Verification

- `deno task check` formats, lints, and type-checks the package.
- `deno task test` covers descriptors, codecs, typing, helpers, the remote
  driver, semantic field/structure reuse, evaluator validation, SQL compilation,
  and schema validation. Native database tests run this package against both the
  SQL and transaction bridge; live PostgreSQL coverage requires the configured
  disposable test database.
