import {
  columns,
  decimal,
  field,
  money,
  t,
  table,
  z,
} from "/p/the8020/db/mod.ts";

const name = field(z.string(), {
  label: "Name",
  description: "The sample's **name**.",
  valueHelp: () => {
    throw new Error("evaluation must not invoke field help");
  },
});

export default table("the8020__db__sample_table", {
  id: t.integer().generated().primaryKey(),
  name: t.from(name).unique(),
  ...columns(z.object({ amount: money(), quantity: decimal(12, 3) })),
});
