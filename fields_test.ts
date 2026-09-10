import {
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  choiceHelp,
  decimal,
  field,
  fieldMetadata,
  money,
  z,
} from "./fields.ts";

Deno.test("known choices retain open fields and use typed queries before paging", async () => {
  const source = field(z.string(), { label: "Status" });
  const status = field(source.optional(), {
    valueHelp: choiceHelp(source, [
      { value: "READY", label: "Accepting work" },
      { value: "DRAINING", label: "Finishing existing work" },
      "STOPPED",
    ]),
  });
  assertEquals(status.parse("future state"), "future state");
  assertEquals(status.parse(undefined), undefined);
  assertEquals(fieldMetadata(source)?.valueHelp, undefined);
  const help = fieldMetadata(status)!.valueHelp!;
  const page = await help({
    query: {
      search: "work",
      filters: {},
      sort: { column: "value", direction: "asc" },
    },
    offset: 1,
    limit: 1,
  });
  assertEquals(Object.keys(page.schema.shape), ["value", "label"]);
  assertEquals(fieldMetadata(page.schema.shape.value!)?.label, "Status");
  assertEquals(page.rows, [{ value: "READY", label: "Accepting work" }]);
  assertEquals(page.more, false);
  assertEquals(page.totalItems, 2);
  assertEquals(page.totalSourceItems, 3);
  const filtered = await help({
    query: { search: "", filters: { value: "STOPPED" }, sort: null },
    offset: 0,
    limit: 1,
  });
  assertEquals(filtered.rows, [{ value: "STOPPED", label: "STOPPED" }]);
  const numeric = await choiceHelp(z.number(), [2, 10, 1])({
    query: {
      search: "",
      filters: { value: ">1" },
      sort: { column: "value", direction: "asc" },
    },
    offset: 0,
    limit: 1,
  });
  assertEquals(numeric.rows, [{ value: 2, label: "2" }]);
  assertEquals(numeric.more, true);
});

Deno.test("decimal and money fields validate exact values with shared storage", () => {
  const amount = money();
  for (const value of ["0.00", "125.50", "-125.50", "9999999999999999.99"]) {
    assertEquals(amount.parse(value), value);
  }
  for (
    const value of [
      125.50,
      "125.5",
      "125.500",
      "1e2",
      "01.00",
      "-0.00",
      "10000000000000000.00",
    ]
  ) {
    assertEquals(amount.safeParse(value).success, false, String(value));
  }
  assertEquals(decimal(4, 3).parse("1.250"), "1.250");
  assertEquals(decimal(4, 0).parse("1250"), "1250");
  assertEquals(money(4, 3).parse("1.250"), "1.250");
  assertThrows(() => decimal(19, 2), TypeError, "precision");
  assertThrows(() => decimal(2, 3), TypeError, "scale");
});

Deno.test("field storage survives refinement, wrappers, and structure composition", () => {
  const amount = money(16, 2).refine((value) => value !== "0.00");
  const structure = z.object({ amount }).pick({ amount: true }).extend({
    discount: field(amount.nullable().readonly(), { label: "Discount" }),
  });
  for (
    const schema of [
      amount,
      amount.clone(),
      structure.shape.amount,
      structure.shape.discount,
    ]
  ) {
    assertEquals(fieldMetadata(schema)?.storage, {
      type: "decimal",
      precision: 16,
      scale: 2,
    });
  }
  assertEquals(structure.shape.amount.safeParse("0.00").success, false);
  assertEquals(structure.shape.discount.parse(null), null);
  assertThrows(
    () => field(amount, { storage: { type: "text" } }),
    TypeError,
    "storage type",
  );
  assertThrows(
    () =>
      field(amount, { storage: { type: "decimal", precision: 18, scale: 2 } }),
    TypeError,
    "storage type",
  );
  assertEquals(fieldMetadata(amount.transform(Number))?.storage, undefined);
  // deno-lint-ignore no-constant-condition
  if (false) {
    field(z.number(), {
      // @ts-expect-error a numeric Zod value cannot use decimal-string storage
      storage: { type: "decimal", precision: 18, scale: 2 },
    });
    // @ts-expect-error a string field cannot use integer storage
    field(z.string(), { storage: { type: "integer" } });
  }
});

Deno.test("semantic fields retain validation and customize each use independently", async () => {
  const schema = z.object({ value: z.string(), label: z.string() });
  const valueHelp = () => ({
    schema,
    rows: [{ value: "alice", label: "Alice" }],
    more: false,
  });
  const opened: string[] = [];
  const user = field(z.string().min(1), {
    label: "User",
    description: "Choose the **account** responsible for this work.",
    valueHelp,
    open: (value) => {
      opened.push(value);
    },
  });
  const owner = field(user, { label: "Owner" });
  assertNotEquals(user, owner);
  assertEquals(user.safeParse("").success, false);
  assertEquals(owner.parse("alice"), "alice");
  assertEquals(fieldMetadata(user)?.label, "User");
  assertEquals(fieldMetadata(owner)?.label, "Owner");
  assertStrictEquals(fieldMetadata(owner)?.valueHelp, valueHelp);
  await fieldMetadata(owner)?.open?.("alice");
  assertEquals(opened, ["alice"]);
  assertEquals(
    await fieldMetadata(owner)?.valueHelp?.({
      query: { search: "ali", filters: {}, sort: null },
      offset: 0,
      limit: 20,
    }),
    valueHelp(),
  );
});

Deno.test("ordinary Zod structures preserve fields through includes and wrappers", () => {
  const user = field(z.string(), { label: "User", description: "An account." });
  const assignment = z.object({ owner: user, enabled: z.boolean() });
  const form = assignment.extend({ reviewer: user.nullable().optional() });
  assertEquals<unknown>(
    fieldMetadata(form.shape.reviewer),
    fieldMetadata(user),
  );
  assertEquals(fieldMetadata(assignment.partial().shape.owner)?.label, "User");
  assertEquals(
    fieldMetadata(
      field(form.shape.reviewer, { description: "A second reader." }),
    ),
    { label: "User", description: "A second reader." },
  );
  assertEquals(fieldMetadata(user)?.description, "An account.");
  assertEquals(assignment.pick({ owner: true }).parse({ owner: "alice" }), {
    owner: "alice",
  });
  assertEquals(
    fieldMetadata(
      z.string().meta({ title: "Name", description: "Full name." }),
    ),
    { label: "Name", description: "Full name." },
  );
});
