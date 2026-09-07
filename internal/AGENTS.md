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

- Reuse the ordinary bounded job runtime for evaluation and keep output
  deterministic. A new schema need belongs in the shared descriptor contract,
  not an evaluator-specific runtime or application branch in Go.

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
