# Purpose

- Provide the package-defined 80|20 database schema DSL, Kysely runtime driver,
  sandboxed table evaluator, and database administration program.
- This file is the root contract of the independent `the8020/db` repository.

# Ownership

- Own authored TypeScript table descriptors, logical value codecs, the
  application-facing `@the8020/db` API, and the non-discoverable evaluator job.
- Own database table administration screens backed only by typed kernel
  commands.
- Do not own credentials, connections, physical DDL, schema deployment order,
  package activation, or database readiness; those belong to the Go kernel.

# Local Contracts

- Table modules at `packages/<namespace>/<package>/tables/<table>.ts` are the
  only authored schema source and default-export one `table()` object whose ID
  matches its normalized path.
- Logical types are deliberately limited to text, boolean, safe integer, finite
  float, scaled decimal string, datetime, bytes, JSON, and string enum.
- Table helpers return ordinary Kysely builders after the first call. Direct
  Kysely use remains available through `db`.
- Runtime database calls use the package-neutral `@the8020/kernel` bridge and
  never receive backend credentials. The non-secret backend name is injected
  before module import so compiler selection performs no bootstrap callback.
- `internal/evaluator.ts` is a bounded job entrypoint, not a discoverable UUI
  program. It imports validated table modules and returns deterministic plain
  descriptors.

# Work Guidance

- Keep the DSL and remote driver small. Prefer Kysely's compiler and builders
  over custom query syntax or expression parsing.
- Keep rare engine-native/raw expression results explicit rather than adding a
  complete runtime SQL type interpreter.

# Verification

- `deno task check` formats, lints, and type-checks the package.
- `deno task test` covers descriptors, codecs, typing, helpers, the remote
  driver, evaluator validation, and administration view models.

# Child DOX Index
