# Purpose

- Provide the package-defined 80|20 database schema DSL, Kysely runtime driver,
  and sandboxed table evaluator.
- This file is the root contract of the independent `the8020/db` repository.

# Ownership

- Own authored TypeScript table descriptors, logical value codecs,
  administrative command programs, the application-facing `/p/the8020/db/mod.ts`
  API, and the non-discoverable evaluator job.
- Do not own credentials, connections, physical DDL, schema deployment order,
  package activation, or database readiness; those belong to the Go kernel.

# Local Contracts

- Table modules at `packages/<namespace>/<package>/tables/<table>.ts` are the
  only authored schema source and default-export one `table()` object whose ID
  matches its normalized path.
- Logical types are deliberately limited to text, boolean, safe integer, finite
  float, scaled decimal string, datetime, bytes, JSON, and string enum.
- `codecs.ts` exposes the same descriptor-aware result decoding used by the
  Kysely runtime to trusted consumers of the raw kernel database API.
- Table helpers return ordinary Kysely builders after the first call. Direct
  Kysely use remains available through `db`.
- Runtime database calls use the package-neutral `@the8020/kernel` bridge and
  never receive backend credentials. The non-secret backend name is injected
  before module import so compiler selection performs no bootstrap callback.
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
- `cbus/commands/**/command.toml` maps visible `db.*` and `db.tables.*` commands
  to non-discoverable ordinary programs whose default exports parse raw string
  arguments, report intentional input errors structurally, and use typed kernel
  database operations.

# Work Guidance

- Keep the DSL and remote driver small. Prefer Kysely's compiler and builders
  over custom query syntax or expression parsing.
- Keep rare engine-native/raw expression results explicit rather than adding a
  complete runtime SQL type interpreter.

# Verification

- `deno task check` formats, lints, and type-checks the package.
- `deno task test` covers descriptors, codecs, typing, helpers, the remote
  driver, and evaluator validation.

# Child DOX Index
