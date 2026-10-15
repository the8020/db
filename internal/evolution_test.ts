import { assertEquals } from "@std/assert";
import type { IndexDescriptor, TableDescriptor } from "../src/schema.ts";
import { migrationReasons } from "./evolution.ts";

Deno.test("index cleanup runs only for tightened uniqueness", () => {
  const definition = (indexes: IndexDescriptor[]): TableDescriptor => ({
    format_version: 1,
    table_id: "acme__orders__orders",
    columns: [],
    primary_key: [],
    indexes,
  });
  const ordinary = { name: "orders_total", columns: ["total"], unique: false };
  const unique = { ...ordinary, unique: true };
  const composite = { ...unique, columns: ["total", "status"] };
  const cases: Array<[IndexDescriptor[], IndexDescriptor[], string[]]> = [
    [[ordinary], [], []],
    [[], [ordinary], []],
    [[ordinary], [{ ...ordinary, columns: ["status"] }], []],
    [[unique], [ordinary], []],
    [[unique], [{ ...unique, name: "renamed" }], []],
    [[unique], [composite], []],
    [[composite], [{ ...composite, columns: ["status", "total"] }], []],
    [[], [unique], ["changing index orders_total"]],
    [[ordinary], [unique], ["changing index orders_total"]],
    [[composite], [unique], ["changing index orders_total"]],
  ];
  for (const backend of ["sqlite", "postgresql"]) {
    for (const [previous, next, expected] of cases) {
      assertEquals(
        migrationReasons(definition(previous), definition(next), backend),
        expected,
      );
    }
    const keyed = { ...definition([]), primary_key: ["id"] };
    assertEquals(
      migrationReasons(keyed, {
        ...keyed,
        indexes: [{ name: "id_unique", columns: ["id"], unique: true }],
      }, backend),
      [],
    );
  }
});
