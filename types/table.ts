import { field, z } from "../fields.ts";

export const tableId: z.ZodString = field(z.string(), {
  label: "Database table",
  description:
    "Choose a table by its name or owning package. Open it to browse rows and inspect its fields.",
  valueHelp: async ({ query, offset, limit }) => {
    const { kernel } = await import("@the8020/kernel");
    const search = query.trim().toLowerCase();
    const matches = (await kernel.database.tables.list()).filter((row) =>
      `${row.table_id} ${row.source_package} ${row.source_module}`.toLowerCase()
        .includes(search)
    ).sort((a, b) => a.table_id.localeCompare(b.table_id));
    return {
      items: matches.slice(offset, offset + limit).map((row) => ({
        value: row.table_id,
        label: row.table_id,
        description: `${row.source_package} · ${row.state}`,
      })),
      more: offset + limit < matches.length,
    };
  },
  open: async (value) => {
    const { default: database } = await import(
      "/p/the8020/admin-db/programs/database/program.ts"
    );
    await database(value);
  },
});
