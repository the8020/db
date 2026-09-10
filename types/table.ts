import { choiceHelp, field, z } from "../fields.ts";

export const tableId: z.ZodString = field(z.string(), {
  label: "Database table",
  description:
    "Choose a table by its name or owning package. Open it to browse rows and inspect its fields.",
  valueHelp: async (request) => {
    const { kernel } = await import("@the8020/kernel");
    const { queryValueHelp } = await import("/p/the8020/uui/lists.ts");
    const { packageId } = await import("/p/the8020/packages/types/package.ts");
    const { sourceInfo } = await import("/p/the8020/packages/types/source.ts");
    const rows = (await kernel.database.tables.list()).sort((a, b) =>
      a.table_id.localeCompare(b.table_id)
    ).map((row) => ({
      tableId: row.table_id,
      package: row.source_package,
      module: row.source_module,
      state: row.state,
    }));
    return queryValueHelp(
      z.object({
        tableId,
        package: packageId,
        module: sourceInfo.shape.path,
        state: field(z.string(), {
          label: "Status",
          description: "The table's current catalog state.",
          valueHelp: choiceHelp(z.string(), ["active", "retired"]),
        }),
      }),
      rows,
      request,
    );
  },
  open: async (value) => {
    const { default: database } = await import(
      "/p/the8020/admin-db/programs/database/program.ts"
    );
    await database(value);
  },
});
