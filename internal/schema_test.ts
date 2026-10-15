import { assertEquals, assertRejects } from "@std/assert";
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import schemaEntry, { Schema } from "./schema.ts";

Deno.test("schema job rejects old native capability before SQL", async () => {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const invoke = globals[kernelInvokeSymbol],
    backend = globals[kernelDatabaseBackendSymbol];
  const calls: string[] = [];
  globals[kernelDatabaseBackendSymbol] = "sqlite";
  globals[kernelInvokeSymbol] = (operation: string) => {
    calls.push(operation);
    return Promise.resolve({ success: true, result: 1 });
  };
  try {
    const result = await schemaEntry({ operation: "initialize" });
    assertEquals(result.error?.includes("updated kernel"), true);
    assertEquals(calls, ["runtime.operation"]);
  } finally {
    globals[kernelInvokeSymbol] = invoke;
    globals[kernelDatabaseBackendSymbol] = backend;
  }
});

Deno.test("schema transactions preserve publication locking and rollback", async () => {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previous = globals[kernelInvokeSymbol];
  const calls: string[] = [];
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: { statement?: string },
  ) => {
    calls.push(operation === "database.execute" ? input.statement! : operation);
    return Promise.resolve(
      operation === "database.transaction.begin"
        ? { transaction: "schema-transaction" }
        : { columns: [], rows: [], affected_rows: 0 },
    );
  };
  try {
    await new Schema("postgresql").atomic(() => Promise.resolve());
    assertEquals(calls, [
      "database.transaction.begin",
      "SELECT pg_advisory_xact_lock(802020260901)",
      "database.transaction.commit",
    ]);
    calls.length = 0;
    await assertRejects(
      () =>
        new Schema("postgresql", true).atomic(() =>
          Promise.reject(new Error("DDL failed"))
        ),
      Error,
      "DDL failed",
    );
    assertEquals(calls, [
      "database.transaction.begin",
      "database.transaction.rollback",
    ]);
  } finally {
    globals[kernelInvokeSymbol] = previous;
  }
});

Deno.test("metadata planning never probes application rows", async () => {
  const calls: string[] = [];
  const globals = globalThis as unknown as Record<symbol, unknown>,
    previous = globals[kernelInvokeSymbol];
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: { statement?: string },
  ) => {
    calls.push(input.statement ?? operation);
    return Promise.resolve(
      operation === "database.info"
        ? { maximum_result_rows: 128 }
        : { columns: [], rows: [] },
    );
  };
  try {
    const plan = await new Schema("sqlite").plan([]);
    assertEquals(plan.tables, []);
    assertEquals(calls.every((s) => !/COUNT|EXCEPT|SELECT 1/.test(s)), true);
  } finally {
    globals[kernelInvokeSymbol] = previous;
  }
});
