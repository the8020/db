import type { Kysely } from "./kysely.ts";
import type { ColumnDescriptor, TableDescriptor } from "./src/schema.ts";

/** Callbacks may retry before commit. Use only tx; external side effects are forbidden. */
export interface MigrationContext {
  activationId: string;
  previous: {
    descriptor: TableDescriptor;
    hash: string;
    retained: ColumnDescriptor[];
  };
  next: { descriptor: TableDescriptor; hash: string };
  /** Current physical table; cleanup updates/deletes must fit its old schema. */
  table: string;
  /** Transaction-bound Kysely; db alone owns DDL, swap, catalog and commit. */
  tx: Kysely<Record<string, Record<string, unknown>>>;
}

export type TableMigration = (context: MigrationContext) => Promise<void>;

export interface SchemaPlan {
  identity: string;
  tables: Array<{
    table_id: string;
    source_package: string;
    previous_hash: string;
    target_hash: string;
    route: "automatic" | "cleanup" | "attempt";
    reasons: string[];
    affected_columns: Array<
      { name: string; repair: "null" | "default" | "unsupported" }
    >;
    retired_columns: string[];
    incoming_references: string[];
  }>;
}
