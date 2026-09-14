import { assertEquals, assertRejects } from "@std/assert";
import { kernelInvokeSymbol } from "@the8020/kernel";
import { Schema } from "./schema.ts";

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
