Parent DOX: [db DOX](../AGENTS.md).

# Purpose

- Evaluate validated table modules into deterministic plain descriptors.

# Ownership

- Own the bounded `evaluator.ts` job entrypoint and `evaluator_test.ts`.

# Local Contracts

- The evaluator is internal and non-discoverable; validate module paths,
  expected table identity, batch bounds, and returned descriptors.
- Evaluation describes schema; the kernel owns connections, physical DDL, and
  deployment ordering.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
