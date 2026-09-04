import { t, table } from "/p/the8020/db/mod.ts";

export default table("the8020__db__sample_table", {
  id: t.integer().generated().primaryKey(),
  name: t.text().unique(),
});
