/** Bootstrap metadata owned by db; it does not depend on its own table evaluator. */
import type { Backend } from "./ddl.ts";
export const catalogVersion = 2;
export function catalogStatements(backend: Backend): string[] {
  const integer = backend === "sqlite" ? "INTEGER" : "bigint";
  const table = (name: string, columns: string) =>
    `CREATE TABLE IF NOT EXISTS ${name} (${columns})${
      backend === "sqlite" ? " STRICT" : ""
    }`;
  return [
    table(
      "_8020_catalog",
      `catalog_id TEXT PRIMARY KEY, catalog_version ${integer} NOT NULL,
      initialized ${integer} NOT NULL, package_set_hash TEXT NOT NULL, package_set_json TEXT NOT NULL,
      descriptor_set_hash TEXT NOT NULL, created_at TEXT NOT NULL, initialized_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, last_error TEXT NOT NULL, last_deployment_at TEXT NOT NULL, last_deployment_error TEXT NOT NULL`,
    ),
    table(
      "_8020_tables",
      `table_id TEXT PRIMARY KEY, descriptor_hash TEXT NOT NULL, descriptor_json TEXT NOT NULL,
      source_package TEXT NOT NULL, source_commit TEXT NOT NULL, source_module TEXT NOT NULL,
      state TEXT NOT NULL, synchronization_state TEXT NOT NULL, synchronized_at TEXT NOT NULL, error TEXT NOT NULL`,
    ),
    "CREATE INDEX IF NOT EXISTS _8020_tables_source_package ON _8020_tables (source_package)",
    table(
      "_8020_columns",
      `table_id TEXT NOT NULL, column_name TEXT NOT NULL, ordinal ${integer} NOT NULL,
      logical_type TEXT NOT NULL, definition_hash TEXT NOT NULL, definition_json TEXT NOT NULL,
      state TEXT NOT NULL, PRIMARY KEY (table_id, column_name)`,
    ),
    table(
      "_8020_dependencies",
      "table_id TEXT NOT NULL, module_path TEXT NOT NULL, PRIMARY KEY (table_id, module_path)",
    ),
    "CREATE INDEX IF NOT EXISTS _8020_dependencies_module_path ON _8020_dependencies (module_path)",
    table(
      "_8020_pending_deployment",
      `deployment_id TEXT PRIMARY KEY, previous_package_set_hash TEXT NOT NULL,
      previous_package_set_json TEXT NOT NULL, candidate_package_set_hash TEXT NOT NULL, candidate_package_set_json TEXT NOT NULL,
      candidates_json TEXT NOT NULL, stage TEXT NOT NULL, error TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL`,
    ),
  ];
}
export const catalogChecks = [
  "SELECT catalog_id, catalog_version, initialized, package_set_hash, package_set_json, descriptor_set_hash, created_at, initialized_at, updated_at, last_error, last_deployment_at, last_deployment_error FROM _8020_catalog WHERE 1 = 0",
  "SELECT table_id, descriptor_hash, descriptor_json, source_package, source_commit, source_module, state, synchronization_state, synchronized_at, error FROM _8020_tables WHERE 1 = 0",
  "SELECT table_id, column_name, ordinal, logical_type, definition_hash, definition_json, state FROM _8020_columns WHERE 1 = 0",
  "SELECT table_id, module_path FROM _8020_dependencies WHERE 1 = 0",
  "SELECT deployment_id, previous_package_set_hash, previous_package_set_json, candidate_package_set_hash, candidate_package_set_json, candidates_json, stage, error, started_at, updated_at FROM _8020_pending_deployment WHERE 1 = 0",
];
