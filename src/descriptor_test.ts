import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { kernelInvokeSymbol } from "@the8020/kernel";
import type { TableDatabase } from "../mod.ts";

const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
(globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] = (
  operation: string,
  input: Record<string, unknown>,
) => {
  calls.push({ operation, input });
  if (operation === "database.info") {
    return Promise.resolve({ backend: "sqlite", state: "READY" });
  }
  if (operation === "database.execute") {
    return Promise.resolve({
      columns: ["id"],
      rows: [["order-1"]],
    });
  }
  return Promise.reject(new Error(`unexpected operation ${operation}`));
};

const {
  columns,
  descriptorOf,
  table,
  t,
} = await import("../mod.ts");

const TransactionOrders = table("the8020__example__transactions", {
  id: t.text().primaryKey(),
});
const JoinCustomers = table("the8020__example__customers", {
  id: t.text().primaryKey(),
});

declare module "@the8020/db/types" {
  interface Database extends TableDatabase<typeof TransactionOrders> {}
  interface Database extends TableDatabase<typeof JoinCustomers> {}
}

Deno.test("table descriptor preserves logical schema and composite keys", () => {
  const audit = columns({
    createdAt: t.datetime().defaultNow(),
    metadata: t.json<{ source?: string }>().nullable(),
  });
  const Orders = table("the8020__example__orders", {
    ...audit,
    orderId: t.text().primaryKey(),
    itemId: t.integer().primaryKey(),
    status: t.enum(["draft", "confirmed"] as const).default("draft"),
    total: t.decimal(18, 2),
  }, {
    indexes: [{ columns: ["status"] }],
  });
  const descriptor = descriptorOf(Orders);
  assertEquals(Orders.orderId, "the8020__example__orders.orderId");
  assertEquals(descriptor.primary_key, ["orderId", "itemId"]);
  assertEquals(descriptor.columns[0]?.default, { kind: "now" });
  assertEquals(descriptor.columns[2]?.logical_type, "text");
  assertEquals(descriptor.columns[4]?.enum_values, ["confirmed", "draft"]);
  assertEquals(descriptor.indexes[0]?.columns, ["status"]);
});

Deno.test("table validation rejects ambiguous or nonportable definitions", () => {
  assertThrows(() => table("namespace/package/table", { id: t.text() }));
  assertThrows(() => table("namespace__package__table", { select: t.text() }));
  assertThrows(() =>
    table("namespace__package__table", {
      id: t.text().generated().primaryKey(),
    })
  );
  assertThrows(() => t.decimal(19, 2));
  assertThrows(() => t.enum(["same", "same"]));
});

Deno.test("table accepts a canonical shortened physical identifier", () => {
  const id = `${"a".repeat(52)}_0123456789`;
  const shortened = table(id, { id: t.text().primaryKey() });
  assertEquals(shortened.table, id);
});

Deno.test("descriptor normalization ignores semantically irrelevant order", () => {
  const First = table("the8020__example__normalized_first", {
    status: t.enum(["z", "a"] as const),
    metadata: t.json<{ z: number; a: { y: number; x: number } }>().default({
      z: 1,
      a: { y: 2, x: 3 },
    }),
  }, {
    indexes: [
      { name: "z_index", columns: ["status"] },
      { name: "a_index", columns: ["metadata"] },
    ],
  });
  const descriptor = descriptorOf(First);
  assertEquals(descriptor.columns[0]?.enum_values, ["a", "z"]);
  assertEquals(descriptor.columns[1]?.default?.value, {
    a: { x: 3, y: 2 },
    z: 1,
  });
  assertEquals(descriptor.indexes.map((index) => index.name), [
    "a_index",
    "z_index",
  ]);
});

Deno.test("table helpers return standard Kysely builders", async () => {
  calls.length = 0;
  const Orders = table("the8020__example__helpers", {
    id: t.text().primaryKey(),
    customerId: t.text(),
    enabled: t.boolean().default(true),
  });
  const builder = Orders.select([Orders.id])
    .innerJoin(
      JoinCustomers.table,
      JoinCustomers.id,
      Orders.customerId,
    )
    .where(Orders.enabled, "=", true);
  assertEquals(typeof builder.innerJoin, "function");
  const rows = await builder.execute();
  assertEquals(rows, [{ id: "order-1" }]);
  assertEquals(calls[0]?.operation, "database.execute");
  assertEquals(typeof calls[0]?.input.statement, "string");
});

Deno.test("runtime selects the backend-specific Kysely compiler", async () => {
  const { createDatabase } = await import("./runtime.ts");
  const compile = (backend: "sqlite" | "postgresql") =>
    createDatabase(backend)
      .selectFrom(TransactionOrders.table)
      .select(TransactionOrders.id)
      .where(TransactionOrders.id, "=", "one")
      .compile().sql;
  assertEquals(compile("sqlite").includes("?"), true);
  assertEquals(compile("postgresql").includes("$1"), true);
});

Deno.test("logical values use tagged parameters and typed direct results", async () => {
  const Typed = table("the8020__example__typed", {
    id: t.text().primaryKey(),
    enabled: t.boolean(),
    total: t.decimal(18, 2),
    createdAt: t.datetime(),
    payload: t.bytes(),
    metadata: t.json<{ source: string }>(),
  });
  let parameters: unknown[] = [];
  let selecting = false;
  (globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    if (operation === "database.info") {
      return Promise.resolve({ backend: "sqlite", state: "READY" });
    }
    if (operation === "database.execute") {
      parameters = input.parameters as unknown[];
      if (selecting) {
        return Promise.resolve({
          columns: [
            "id",
            "enabled",
            "total",
            "createdAt",
            "payload",
            "metadata",
          ],
          rows: [[
            "one",
            1,
            12550,
            "2026-09-02T10:00:00.000Z",
            { type: "bytes", value: "AP7/" },
            '{"source":"test"}',
          ]],
        });
      }
      return Promise.resolve({ columns: [], rows: [] });
    }
    return Promise.reject(new Error(`unexpected operation ${operation}`));
  };
  const instant = new Date("2026-09-02T10:00:00.000Z");
  await Typed.insert({
    id: "one",
    enabled: true,
    total: "125.50",
    createdAt: instant,
    payload: new Uint8Array([0, 254, 255]),
    metadata: { source: "test" },
  }).execute();
  assertEquals(parameters, [
    "one",
    true,
    { type: "decimal", value: "125.50", precision: 18, scale: 2 },
    { type: "datetime", value: instant.toISOString() },
    { type: "bytes", value: "AP7/" },
    { type: "json", value: { source: "test" } },
  ]);
  selecting = true;
  const rows = await Typed.selectAll().where(Typed.total, ">", "100.00")
    .execute();
  assertEquals(parameters, [
    { type: "decimal", value: "100.00", precision: 18, scale: 2 },
  ]);
  assertEquals(rows, [{
    id: "one",
    enabled: true,
    total: "125.50",
    createdAt: instant,
    payload: new Uint8Array([0, 254, 255]),
    metadata: { source: "test" },
  }]);
});

Deno.test("transactions use explicit kernel transaction tokens", async () => {
  (globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    if (operation === "database.info") {
      return Promise.resolve({ backend: "sqlite", state: "READY" });
    }
    if (operation === "database.transaction.begin") {
      return Promise.resolve({ transaction: "tx-1" });
    }
    if (operation === "database.transaction.commit") return Promise.resolve();
    if (operation === "database.execute") {
      assertEquals(input.transaction, "tx-1");
      return Promise.resolve({
        columns: [],
        rows: [],
        affected_rows: {
          type: "bigint",
          value: "1",
        },
      });
    }
    return Promise.reject(new Error(`unexpected operation ${operation}`));
  };
  await (await import("../mod.ts")).db.transaction().execute(async (trx) => {
    await trx.insertInto(TransactionOrders.table).values({ id: "one" })
      .execute();
  });
});

Deno.test("failed transaction callbacks explicitly roll back", async () => {
  const operations: string[] = [];
  (globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] = (
    operation: string,
  ) => {
    operations.push(operation);
    if (operation === "database.transaction.begin") {
      return Promise.resolve({ transaction: "tx-rollback" });
    }
    if (operation === "database.transaction.rollback") {
      return Promise.resolve();
    }
    return Promise.reject(new Error(`unexpected operation ${operation}`));
  };
  await assertRejects(
    () =>
      (async () => {
        const { db } = await import("../mod.ts");
        await db.transaction().execute(() => {
          throw new Error("rollback marker");
        });
      })(),
    Error,
    "rollback marker",
  );
  assertEquals(operations, [
    "database.transaction.begin",
    "database.transaction.rollback",
  ]);
});

Deno.test("raw SQL uses unified row-returning execution", async () => {
  let request: Record<string, unknown> | undefined;
  (globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    if (operation === "database.execute") {
      request = input;
      return Promise.resolve({ columns: ["answer"], rows: [[42]] });
    }
    return Promise.reject(new Error(`unexpected operation ${operation}`));
  };
  const { db, sql } = await import("../mod.ts");
  assertEquals(
    await sql<{ answer: number }>`SELECT ${42} AS answer`.execute(db),
    {
      rows: [{ answer: 42 }],
    },
  );
  assertEquals(request?.return_rows, true);
});

Deno.test("streaming clearly reports the phase-one boundary", async () => {
  const Orders = table("the8020__example__stream", { id: t.text() });
  await assertRejects(
    async () => {
      for await (const _ of Orders.selectAll().stream()) {
        // No rows can be produced by the deliberately unsupported driver path.
      }
    },
    Error,
    "streaming is not implemented",
  );
});
