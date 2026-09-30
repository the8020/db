import { assertEquals, assertRejects } from "@std/assert";
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import { Schema } from "./schema.ts";
import type { TableDescriptor } from "../src/schema.ts";

(globalThis as unknown as Record<symbol, unknown>)[
  kernelDatabaseBackendSymbol
] = "postgresql";
const { table, t } = await import("../mod.ts");
const { descriptorOf } = await import("../src/descriptor.ts");

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

Deno.test("schema changes ignore object key order from the kernel transport", async () => {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previous = globals[kernelInvokeSymbol];
  const statements: string[] = [];
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: { statement?: string },
  ) => {
    if (operation === "database.info") {
      return Promise.resolve({ maximum_result_rows: 1000 });
    }
    if (operation === "database.execute") statements.push(input.statement!);
    return Promise.resolve({ columns: [], rows: [], affected_rows: 0 });
  };
  const reversed = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reversed)
      : value !== null && typeof value === "object"
      ? Object.fromEntries(
        Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]),
      )
      : value;
  try {
    const stored = descriptorOf(
      table("acme__schema__orders", {
        orderId: t.text().primaryKey(),
        status: t.enum(["draft", "done"] as const).default("draft"),
        note: t.text().nullable(),
      }, { indexes: [{ columns: ["status"] }] }),
    );
    const transported = reversed(stored) as TableDescriptor;
    const schema = new Schema("postgresql");
    await schema.applyChange(
      JSON.parse(JSON.stringify(stored)),
      transported,
      false,
    );
    assertEquals(
      statements.some((statement) => statement.startsWith("ALTER TABLE")),
      false,
    );
    await assertRejects(
      () =>
        schema.applyChange(stored, {
          ...transported,
          columns: transported.columns.map((column) =>
            column.name === "note" ? { ...column, nullable: false } : column
          ),
        }, false),
      Error,
      "changing column note requires a migration",
    );
    await assertRejects(
      () =>
        schema.applyChange(stored, {
          ...transported,
          indexes: transported.indexes!.map((index) => ({
            ...index,
            columns: ["status", "note"],
          })),
        }, false),
      Error,
      "requires a migration",
    );
  } finally {
    globals[kernelInvokeSymbol] = previous;
  }
});
