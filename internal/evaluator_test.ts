import { assertEquals, assertRejects } from "@std/assert";
import { kernelInvokeSymbol } from "@the8020/kernel";

(globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] = (
  operation: string,
) =>
  operation === "database.info"
    ? Promise.resolve({ backend: "sqlite", state: "READY" })
    : Promise.reject(
      new Error("database execution is denied during evaluation"),
    );

const { default: evaluate } = await import("./evaluator.ts");

Deno.test("evaluator returns deterministic descriptors for a batch", async () => {
  const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  const module = `${root}/testdata/sample_table.ts`;
  const input = {
    package_root: root,
    tables: [{
      module,
      expected_table_id: "the8020__db__sample_table",
      package_id: "the8020/db",
      package_commit: "abc123",
    }],
  };
  const first = await evaluate(input);
  const second = await evaluate(input);
  assertEquals(first, second);
  assertEquals(
    first.tables[0]?.descriptor.table_id,
    "the8020__db__sample_table",
  );
  assertEquals(first.tables[0]?.descriptor_hash.length, 64);
});

Deno.test("evaluator validates expected filesystem identity", async () => {
  const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  await assertRejects(
    () =>
      evaluate({
        package_root: root,
        tables: [{
          module: `${root}/testdata/sample_table.ts`,
          expected_table_id: "the8020__db__wrong",
          package_id: "the8020/db",
          package_commit: "abc123",
        }],
      }),
    TypeError,
    "expected the8020__db__wrong",
  );
});
