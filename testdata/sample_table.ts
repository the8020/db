import { t, table } from "@the8020/db";

export default table("the8020__db__sample_table", {
  id: t.integer().generated().primaryKey(),
  name: t.text().unique(),
});
