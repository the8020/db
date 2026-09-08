import { assertEquals, assertRejects } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import { field, z } from "./fields.ts";
import { lookupPage } from "./lookup.ts";

const globals = globalThis as unknown as Record<symbol, unknown>;
globals[kernelDatabaseBackendSymbol] = "sqlite";
const { table, columns } = await import("./mod.ts");
const schema = z.object({
  id: field(z.string(), { label: "Key" }),
  label: z.string().nullable(),
  enabled: z.boolean().nullable(),
});
const Choices = table("the8020__db__lookup_test", columns(schema));

Deno.test("SQL lookup applies column queries before bounded paging and counts matching rows", async () => {
  const database = new DatabaseSync(":memory:");
  const previous = globals[kernelInvokeSymbol];
  const statements: string[] = [];
  database.exec(
    `CREATE TABLE the8020__db__lookup_test (id TEXT, label TEXT, enabled INTEGER);
    INSERT INTO the8020__db__lookup_test VALUES ('a', 'Zulu', 1), ('b', 'alpha', 0), ('c', '100%_match', 1), ('d', '', 0), ('e', NULL, NULL);`,
  );
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    assertEquals(operation, "database.execute");
    const sql = String(input.statement);
    statements.push(sql);
    const rows = database.prepare(sql).all(
      ...input.parameters as Array<string | number>,
    );
    const columns = Object.keys(rows[0] ?? {});
    return Promise.resolve({
      columns,
      rows: rows.map((row) => columns.map((column) => row[column])),
    });
  };
  const read = (
    search = "",
    filters: Record<string, string> = {},
    offset = 0,
  ) =>
    lookupPage(schema, Choices.select(["id", "label", "enabled"]), {
      query: { search, filters, sort: { column: "label", direction: "desc" } },
      offset,
      limit: 1,
    });
  try {
    const page = await read("", { enabled: "yes" }, 1);
    assertEquals(page.rows, [{ id: "c", label: "100%_match", enabled: true }]);
    assertEquals([page.more, page.totalItems], [false, 2]);
    assertEquals(statements.length, 2);
    assertEquals(statements[0]!.includes("limit"), true);
    assertEquals((await read("%_")).rows, page.rows);
    assertEquals((await read("TRUE")).totalItems, 2);
    assertEquals((await read("", { label: "is:empty" })).totalItems, 2);
    assertEquals((await read("", { label: "is:null" })).totalItems, 1);
    assertEquals((await read("", { label: "is:not-empty" })).totalItems, 3);
    assertEquals((await read("", { enabled: "no" })).totalItems, 2);
    assertEquals((await read("", { enabled: "invalid" })).totalItems, 0);
    const emptyFirst = await lookupPage(
      schema,
      Choices.select(["id", "label", "enabled"]),
      {
        query: {
          search: "",
          filters: {},
          sort: { column: "label", direction: "asc" },
        },
        offset: 0,
        limit: 2,
      },
    );
    assertEquals(emptyFirst.rows.map((row) => row.id), ["d", "e"]);
    const booleanFirst = await lookupPage(
      schema,
      Choices.select(["id", "label", "enabled"]),
      {
        query: {
          search: "",
          filters: {},
          sort: { column: "enabled", direction: "asc" },
        },
        offset: 0,
        limit: 2,
      },
    );
    assertEquals(booleanFirst.rows.map((row) => row.id), ["e", "b"]);
    assertEquals((await read("", { label: "ALPHA" })).rows[0]?.id, "b");
    await assertRejects(
      () => read("", { unknown: "x" }),
      TypeError,
      "unknown lookup column",
    );
  } finally {
    database.close();
    globals[kernelInvokeSymbol] = previous;
  }
});
