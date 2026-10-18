import type { MigrationContext } from "../migrations.ts";
import { sql } from "../kysely.ts";
export async function migrate({ table, next, tx }: MigrationContext) {
  const marker = next.descriptor.columns.find((c) => c.name === "marker")
    ?.default?.value;
  if (marker === "delete" || marker === "delete-fail") {
    await tx.deleteFrom(table).where("status", "=", "draft").execute();
  } else {
    await tx.updateTable(table).set({ status: "confirmed" }).where(
      "status",
      "=",
      "draft",
    ).execute();
  }
  if (marker === "throw") throw new Error("cleanup failed after update");
  if (marker === "wait") {
    await sql`SELECT 1 AS migration_pause`.execute(tx);
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}
