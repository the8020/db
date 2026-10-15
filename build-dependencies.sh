#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
DENO_COMMAND="${DENO_COMMAND:-deno}"
"$DENO_COMMAND" bundle --no-config --no-lock --keep-names --output vendor/kysely.js vendor/kysely.ts
"$DENO_COMMAND" bundle --no-config --no-lock --keep-names --output vendor/zod.js vendor/zod.ts
