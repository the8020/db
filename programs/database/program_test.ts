import { assertEquals, assertThrows } from "@std/assert";
import { requireDestructiveConfirmation, tableAlert } from "./program.ts";

Deno.test("database table list combines actionable alerts", () => {
  assertEquals(
    tableAlert({
      table_id: "acme__orders__orders",
      source_package: "acme/orders",
      source_commit: "commit",
      state: "active",
      synchronization_state: "drift",
      descriptor_hash: "hash",
      active_columns: 4,
      retired_columns: 2,
      error: "physical table is missing",
      definition_state: "commit_mismatch",
    }),
    "physical table is missing; source commit mismatch; 2 retired columns",
  );
});

Deno.test("destructive trim requires deliberate confirmation", () => {
  assertThrows(
    () => requireDestructiveConfirmation(false),
    Error,
    "Confirm permanent deletion",
  );
  requireDestructiveConfirmation(true);
});
