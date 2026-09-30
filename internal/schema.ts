/** Schema/catalog operations run as an ordinary authorized job, separate from table evaluation. */
import { kernel, kernelDatabaseBackend } from "@the8020/kernel";
import { decodeDatabaseValue, encodeDatabaseValue } from "../src/values.ts";
import type { ColumnDescriptor, TableDescriptor } from "../src/schema.ts";
import type { EvaluatedTable } from "./evaluator.ts";
import { catalogChecks, catalogStatements, catalogVersion } from "./catalog.ts";
import {
  type Backend,
  columnSQL,
  compareChecks,
  compareColumn,
  compareIndexes,
  comparePhysical,
  createIndexSQL,
  createTableSQL,
  hash,
  type PhysicalColumn,
  type PhysicalIndex,
  quote,
  validateEvaluatedTable,
  validColumn,
  validTable,
} from "./ddl.ts";

type Row = Record<string, unknown>;
type Commits = Record<string, string>;
interface Candidate {
  package_id: string;
  previous_commit?: string;
  candidate_commit: string;
}
interface Pending {
  ID: string;
  PreviousPackageSetHash: string;
  PreviousPackageCommits: Commits;
  CandidatePackageSetHash: string;
  CandidatePackageCommits: Commits;
  Candidates: Candidate[];
  Stage: string;
  Error: string;
  StartedAt: string;
  UpdatedAt: string;
}
interface CatalogColumn {
  table_id: string;
  column_name: string;
  ordinal: number;
  logical_type: string;
  definition_hash: string;
  definition_json: string;
  state: string;
}
interface Summary {
  table_id: string;
  source_package: string;
  source_commit: string;
  source_module: string;
  state: string;
  synchronization_state: string;
  descriptor_hash: string;
  synchronized_at: string;
  active_columns: number;
  retired_columns: number;
  error: string;
}
interface Detail extends Summary {
  descriptor: TableDescriptor;
  descriptor_json: string;
  columns: CatalogColumn[];
  physical_columns: PhysicalColumn[];
  physical_indexes: PhysicalIndex[];
  physical_checks: string[];
  differences: string[];
  definition_state?: string;
  current_descriptor?: TableDescriptor;
  current_descriptor_hash?: string;
  current_source_commit?: string;
}
interface SyncOptions {
  Full?: boolean;
  Recovery?: boolean;
  SkipReferenceValidation?: boolean;
  RetireMissingPackages?: string[];
  RetireTables?: string[];
}
interface SyncResult {
  table_id: string;
  state: string;
  error?: string;
}
export interface SchemaRequest {
  publication_lock_held?: boolean;
  operation: string;
  input?: Record<string, unknown>;
}
class OperationFailure extends Error {
  constructor(message: string, readonly value: unknown = null) {
    super(message);
  }
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const packageHash = (commits: Commits) =>
  hash(
    Object.entries(commits).map(([id, commit]) => `${id}=${commit}`).sort()
      .join("\n"),
  );
const now = () => new Date().toISOString();

/**
 * Serializes a descriptor fragment with sorted object keys. Stored descriptors
 * keep the evaluator's key order, while descriptors that crossed the kernel
 * transport may not; array order stays significant.
 */
function canonicalJSON(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          ),
        )
        : item,
  );
}

export class Schema {
  private transaction?: string;
  private pageSize?: number;
  constructor(
    readonly backend: Backend,
    private readonly publicationLockHeld = false,
  ) {}
  async rows<T = Row>(
    statement: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    const result = await kernel.database.execute(
      statement,
      parameters.map((v) => encodeDatabaseValue(v)),
      { returnRows: true, transaction: this.transaction },
    );
    return result.rows.map((row) =>
      Object.fromEntries(
        result.columns.map((name, i) => [name, decodeDatabaseValue(row[i]!)]),
      ) as T
    );
  }
  async scan<T = Row>(
    statement: string,
    parameters: unknown[] = [],
    maximum = Infinity,
  ): Promise<T[]> {
    this.pageSize ??= Math.min(
      128,
      (await kernel.database.info()).maximum_result_rows,
    );
    const result: T[] = [];
    // ponytail: Catalog offset scans are bounded per query; use keysets if large catalogs make offsets costly.
    while (result.length < maximum) {
      const limit = Math.min(this.pageSize, maximum - result.length);
      const page = await this.rows<T>(
        `${statement} LIMIT ${limit} OFFSET ${result.length}`,
        parameters,
      );
      result.push(...page);
      if (page.length < limit) break;
    }
    return result;
  }
  async exec(statement: string, parameters: unknown[] = []): Promise<number> {
    const result = await kernel.database.execute(
      statement,
      parameters.map((v) => encodeDatabaseValue(v)),
      { returnRows: false, transaction: this.transaction },
    );
    return Number(decodeDatabaseValue(result.affected_rows ?? 0));
  }
  async one<T = Row>(
    statement: string,
    parameters: unknown[] = [],
  ): Promise<T> {
    const row = (await this.rows<T>(statement, parameters))[0];
    if (!row) throw new Error("sql: no rows in result set");
    return row;
  }
  async atomic<T>(work: () => Promise<T>, bootstrap = false): Promise<T> {
    if (this.transaction) return await work();
    this.transaction =
      (await kernel.database.transaction.begin({ timeoutMs: 300000 }))
        .transaction;
    try {
      // The database owns lock release on rollback, deadline, or Worker exit.
      // Native full synchronization may already hold the publication lock on
      // another connection. Its trusted request records that ownership.
      if (this.backend === "postgresql" && !this.publicationLockHeld) {
        await this.rows("SELECT pg_advisory_xact_lock(802020260901)");
      } else if (this.backend === "sqlite" && !bootstrap) {
        await this.exec(
          "UPDATE _8020_catalog SET catalog_id = catalog_id WHERE catalog_id = 'system'",
        );
      }
      const result = await work();
      await kernel.database.transaction.commit(this.transaction);
      return result;
    } catch (error) {
      await kernel.database.transaction.rollback(this.transaction).catch(
        () => {},
      );
      throw error;
    } finally {
      this.transaction = undefined;
    }
  }
  async exists(name: string): Promise<boolean> {
    const row = await this.one<{ count: number }>(
      this.backend === "sqlite"
        ? "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = $1"
        : "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name = $1",
      [name],
    );
    return row.count !== 0;
  }
  async status(): Promise<Row> {
    const row = await this.one(
      "SELECT * FROM _8020_catalog WHERE catalog_id = 'system'",
    );
    const pending = await this.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM _8020_pending_deployment",
    );
    return {
      catalog_version: row.catalog_version,
      initialized: row.initialized !== 0,
      pending_deployment: pending.count !== 0,
      package_set_hash: row.package_set_hash,
      descriptor_set_hash: row.descriptor_set_hash,
      initialized_at: row.initialized_at,
      catalog_error: row.last_error,
      last_deployment_at: row.last_deployment_at,
      last_deployment_error: row.last_deployment_error,
      state: row.last_error
        ? "INITIALIZATION_FAILED"
        : row.initialized
        ? "READY"
        : "CONNECTED",
    };
  }
  async initialize(): Promise<void> {
    if (!(await this.exists("_8020_catalog"))) {
      await this.atomic(async () => {
        for (const statement of catalogStatements(this.backend)) {
          await this.exec(statement);
        }
        const time = now();
        await this.exec(
          `INSERT INTO _8020_catalog (catalog_id, catalog_version, initialized, package_set_hash, package_set_json, descriptor_set_hash,
          created_at, initialized_at, updated_at, last_error, last_deployment_at, last_deployment_error)
          VALUES ('system', $1, 0, $2, '{}', '', $3, '', $3, '', '', '') ON CONFLICT (catalog_id) DO NOTHING`,
          [catalogVersion, packageHash({}), time],
        );
      }, true);
    }
    // Existing-catalog startup is read-only, including while a SQLite writer runs.
    const row = await this.one<{ catalog_version: number }>(
      "SELECT catalog_version FROM _8020_catalog WHERE catalog_id = 'system'",
    );
    if (row.catalog_version !== catalogVersion) {
      throw new Error(
        `unsupported database catalog version ${row.catalog_version}`,
      );
    }
    try {
      for (const statement of catalogChecks) await this.rows(statement);
    } catch (error) {
      throw new Error(`validate database catalog: ${message(error)}`);
    }
  }
  async catalogState(): Promise<
    {
      PackageSetHash: string;
      PackageCommits: Commits;
      DescriptorSetHash: string;
    }
  > {
    const row = await this.one<
      {
        package_set_hash: string;
        package_set_json: string;
        descriptor_set_hash: string;
      }
    >("SELECT package_set_hash, package_set_json, descriptor_set_hash FROM _8020_catalog WHERE catalog_id = 'system'");
    const commits = JSON.parse(row.package_set_json) as Commits;
    if (packageHash(commits) !== row.package_set_hash) {
      throw new Error("database catalog package-set hash differs");
    }
    return {
      PackageSetHash: row.package_set_hash,
      PackageCommits: commits,
      DescriptorSetHash: row.descriptor_set_hash,
    };
  }
  async descriptorHash(): Promise<string> {
    const rows = await this.scan<{ table_id: string; descriptor_hash: string }>(
      "SELECT table_id, descriptor_hash FROM _8020_tables WHERE state = 'active' ORDER BY table_id",
    );
    return hash(
      rows.map((r) => `${r.table_id}=${r.descriptor_hash}`).join("\n"),
    );
  }
  async completeInitialization(commits: Commits): Promise<void> {
    await this.atomic(async () => {
      await this.exec(
        `UPDATE _8020_catalog SET initialized = 1, package_set_hash = $1, package_set_json = $2, descriptor_set_hash = $3,
        initialized_at = CASE WHEN initialized_at = '' THEN $4 ELSE initialized_at END, updated_at = $4, last_error = '' WHERE catalog_id = 'system'`,
        [
          packageHash(commits),
          JSON.stringify(commits),
          await this.descriptorHash(),
          now(),
        ],
      );
    });
  }
  async pending(id = ""): Promise<Pending | null> {
    const row = (await this.rows<Record<string, string>>(
      `SELECT * FROM _8020_pending_deployment ${
        id
          ? "WHERE deployment_id = $1"
          : "ORDER BY started_at, deployment_id LIMIT 1"
      }`,
      id ? [id] : [],
    ))[0];
    if (!row) return null;
    return {
      ID: row.deployment_id!,
      PreviousPackageSetHash: row.previous_package_set_hash!,
      PreviousPackageCommits: JSON.parse(row.previous_package_set_json!),
      CandidatePackageSetHash: row.candidate_package_set_hash!,
      CandidatePackageCommits: JSON.parse(row.candidate_package_set_json!),
      Candidates: JSON.parse(row.candidates_json!),
      Stage: row.stage!,
      Error: row.error!,
      StartedAt: row.started_at!,
      UpdatedAt: row.updated_at!,
    };
  }
  async beginDeployment(id: string, candidates: Candidate[]): Promise<Pending> {
    if (!/^act-[a-z0-9]{10}$/.test(id)) {
      throw new Error("invalid deployment identity");
    }
    if (!candidates.length || candidates.length > 256) {
      throw new Error("database deployment requires 1..256 candidate packages");
    }
    const selected = new Set(candidates.map((c) => c.package_id));
    if (selected.size !== candidates.length || selected.has("")) {
      throw new Error(
        "database deployment requires distinct package identities",
      );
    }
    return await this.atomic(async () => {
      const claims = await this.scan<
        { deployment_id: string; candidates_json: string }
      >(
        "SELECT deployment_id, candidates_json FROM _8020_pending_deployment ORDER BY deployment_id",
        [],
        257,
      );
      if (claims.length >= 256) {
        throw new Error("database pending deployment capacity reached");
      }
      for (const claim of claims) {
        for (const c of JSON.parse(claim.candidates_json) as Candidate[]) {
          if (selected.has(c.package_id)) {
            throw new Error(
              `package ${c.package_id} belongs to pending deployment ${claim.deployment_id}`,
            );
          }
        }
      }
      if (!(await this.status()).initialized) {
        throw new Error("database catalog is not initialized");
      }
      const state = await this.catalogState(),
        commits = { ...state.PackageCommits };
      for (const c of candidates) {
        c.previous_commit = commits[c.package_id] ?? "";
        if (c.candidate_commit) commits[c.package_id] = c.candidate_commit;
        else delete commits[c.package_id];
      }
      const time = now();
      await this.exec(
        `INSERT INTO _8020_pending_deployment (deployment_id, previous_package_set_hash, previous_package_set_json,
        candidate_package_set_hash, candidate_package_set_json, candidates_json, stage, error, started_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'preparing', '', $7, $7)`,
        [
          id,
          state.PackageSetHash,
          JSON.stringify(state.PackageCommits),
          packageHash(commits),
          JSON.stringify(commits),
          JSON.stringify(candidates),
          time,
        ],
      );
      return (await this.pending(id))!;
    });
  }
  async completeDeployment(id: string, activated: boolean): Promise<void> {
    await this.atomic(async () => {
      const pending = await this.pending(id);
      if (!pending) {
        throw new Error("database schema deployment is not pending");
      }
      const time = now();
      if (activated) {
        const state = await this.catalogState();
        for (const c of pending.Candidates) {
          if (
            (state.PackageCommits[c.package_id] ?? "") !==
              (c.previous_commit ?? "")
          ) {
            throw new Error(
              `active package ${c.package_id} changed during deployment ${id}`,
            );
          }
          if (c.candidate_commit) {
            state.PackageCommits[c.package_id] = c.candidate_commit;
          } else delete state.PackageCommits[c.package_id];
        }
        await this.exec(
          `UPDATE _8020_catalog SET package_set_hash = $1, package_set_json = $2, descriptor_set_hash = $3, updated_at = $4,
          last_error = '', last_deployment_at = $4, last_deployment_error = '' WHERE catalog_id = 'system'`,
          [
            packageHash(state.PackageCommits),
            JSON.stringify(state.PackageCommits),
            await this.descriptorHash(),
            time,
          ],
        );
        for (const c of pending.Candidates) {
          await this.exec(
            "UPDATE _8020_tables SET source_commit = $1 WHERE source_package = $2 AND state = 'active'",
            [c.candidate_commit, c.package_id],
          );
        }
      } else {
        await this.exec(
          "UPDATE _8020_catalog SET updated_at = $1, last_deployment_at = $1, last_deployment_error = $2 WHERE catalog_id = 'system'",
          [
            time,
            pending.Error ||
            "database schema deployment was rolled back before source activation",
          ],
        );
      }
      await this.exec(
        "DELETE FROM _8020_pending_deployment WHERE deployment_id = $1",
        [id],
      );
    });
  }
  async physicalColumns(table: string): Promise<PhysicalColumn[]> {
    if (this.backend === "sqlite") {
      const rows = await this.scan<
        {
          name: string;
          type: string;
          notnull: number;
          pk: number;
          dflt_value: string | null;
        }
      >("SELECT * FROM pragma_table_info($1) ORDER BY cid", [table]);
      const primary = rows.filter((c) => c.pk).length;
      return rows.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.notnull === 0 && c.pk === 0,
        default: c.dflt_value ?? "",
        primary_key: c.pk > 0,
        primary_key_position: c.pk,
        generated: primary === 1 && c.pk > 0 &&
          c.type.toLowerCase() === "integer",
      }));
    }
    const rows = await this.scan<
      {
        column_name: string;
        data_type: string;
        is_nullable: string;
        default_value: string;
        primary_position: number;
        is_identity: string;
      }
    >(
      `SELECT c.column_name, c.data_type, c.is_nullable, COALESCE(c.column_default, '') AS default_value,
      COALESCE((SELECT kcu.ordinal_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = current_schema() AND tc.table_name = c.table_name AND kcu.column_name = c.column_name LIMIT 1), 0) AS primary_position, c.is_identity
      FROM information_schema.columns c WHERE c.table_schema = current_schema() AND c.table_name = $1 ORDER BY c.ordinal_position`,
      [table],
    );
    return rows.map((c) => ({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === "YES",
      default: c.default_value,
      primary_key: c.primary_position > 0,
      primary_key_position: c.primary_position,
      generated: c.is_identity === "YES",
    }));
  }
  async physicalIndexes(table: string): Promise<PhysicalIndex[]> {
    if (this.backend === "sqlite") {
      const rows = await this.scan<
          { name: string; unique: number; origin: string }
        >("SELECT * FROM pragma_index_list($1) ORDER BY seq", [table]),
        result: PhysicalIndex[] = [];
      for (const index of rows.filter((i) => i.origin === "c")) {
        const columns = await this.scan<{ name: string }>(
          "SELECT * FROM pragma_index_info($1) ORDER BY seqno",
          [index.name],
        );
        result.push({
          name: index.name,
          unique: index.unique !== 0,
          columns: columns.map((c) => c.name),
        });
      }
      return result;
    }
    const rows = await this.scan<
      { name: string; unique: boolean; columns: string }
    >(
      `SELECT index_class.relname AS name, index_data.indisunique AS "unique", json_agg(attribute.attname ORDER BY key.ordinality)::text AS columns
      FROM pg_class table_class JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace JOIN pg_index index_data ON index_data.indrelid = table_class.oid
      JOIN pg_class index_class ON index_class.oid = index_data.indexrelid JOIN unnest(index_data.indkey) WITH ORDINALITY AS key(attribute_number, ordinality) ON true
      JOIN pg_attribute attribute ON attribute.attrelid = table_class.oid AND attribute.attnum = key.attribute_number
      LEFT JOIN pg_constraint constraint_data ON constraint_data.conindid = index_class.oid WHERE namespace.nspname = current_schema()
      AND table_class.relname = $1 AND constraint_data.oid IS NULL GROUP BY index_class.relname, index_data.indisunique ORDER BY index_class.relname`,
      [table],
    );
    return rows.map((r) => ({
      name: r.name,
      unique: r.unique,
      columns: JSON.parse(r.columns),
    }));
  }
  async physicalChecks(table: string): Promise<string[]> {
    if (this.backend === "sqlite") {
      const row = (await this.rows<{ sql: string }>(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = $1",
        [table],
      ))[0];
      return [
        ...(row?.sql ?? "").matchAll(/CONSTRAINT\s+"([^"]+)"\s+CHECK\s*\(/gi),
      ].map((m) => m[1]!).sort();
    }
    return (await this.scan<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = current_schema() AND t.relname = $1 AND c.contype = 'c' ORDER BY c.conname`,
      [table],
    )).map((r) => r.conname);
  }
  async ensureIndexes(d: TableDescriptor): Promise<void> {
    for (const index of d.indexes ?? []) {
      await this.exec(createIndexSQL(d.table_id, index));
    }
  }
  async applyChange(
    previous: TableDescriptor,
    next: TableDescriptor,
    recovery: boolean,
  ): Promise<void> {
    const old = new Map(previous.columns.map((c) => [c.name, c])),
      active = new Map(next.columns.map((c) => [c.name, c]));
    const physical = new Map(
      (await this.physicalColumns(next.table_id)).map((c) => [c.name, c]),
    );
    const storage = (
      { reference: _reference, unique: _unique, ...c }: ColumnDescriptor,
    ) => canonicalJSON(c);
    for (const c of next.columns) {
      const before = old.get(c.name);
      if (before) {
        if (storage(before) !== storage(c)) {
          throw new Error(`changing column ${c.name} requires a migration`);
        }
        continue;
      }
      const existing = physical.get(c.name);
      if (existing) {
        if (
          recovery && this.backend === "postgresql" && !c.nullable &&
          existing.nullable &&
          !compareColumn(this.backend, c, { ...existing, nullable: false })
            .length
        ) {
          await this.exec(
            `ALTER TABLE ${quote(next.table_id)} ALTER COLUMN ${
              quote(c.name)
            } SET NOT NULL`,
          );
          existing.nullable = false;
        }
        const differences = compareColumn(this.backend, c, existing);
        if (differences.length) {
          throw new Error(
            `existing column ${c.name} differs: ${differences.join("; ")}`,
          );
        }
      } else {
        if (
          c.primary_key || c.generated ||
          (!c.nullable && c.default?.kind !== "literal")
        ) throw new Error(`adding column ${c.name} requires a migration`);
        await this.exec(
          `ALTER TABLE ${quote(next.table_id)} ADD COLUMN ${
            columnSQL(this.backend, next.table_id, c, false)
          }`,
        );
      }
    }
    for (const c of previous.columns) {
      if (!active.has(c.name) && !c.nullable && !c.default) {
        if (this.backend === "sqlite") {
          throw new Error(
            `retiring required SQLite column ${c.name} requires a migration to relax nullability`,
          );
        }
        await this.exec(
          `ALTER TABLE ${quote(next.table_id)} ALTER COLUMN ${
            quote(c.name)
          } DROP NOT NULL`,
        );
      }
    }
    const indexes = new Map((previous.indexes ?? []).map((i) => [i.name, i]));
    for (const index of next.indexes ?? []) {
      const before = indexes.get(index.name);
      if (before && canonicalJSON(before) !== canonicalJSON(index)) {
        throw new Error(`changing index ${index.name} requires a migration`);
      }
      indexes.delete(index.name);
    }
    for (const [name, index] of indexes) {
      if (index.columns.some((c) => active.has(c))) {
        if (!recovery) {
          throw new Error(`removing index ${name} requires a migration`);
        }
        await this.exec(`DROP INDEX IF EXISTS ${quote(name)}`);
      }
    }
    await this.ensureIndexes(next);
  }
  async writeTable(e: EvaluatedTable): Promise<void> {
    const d = e.descriptor;
    await this.exec(
      `INSERT INTO _8020_tables (table_id, descriptor_hash, descriptor_json, source_package, source_commit, source_module, state, synchronization_state, synchronized_at, error)
      VALUES ($1, $2, $3, $4, $5, $6, 'active', 'synchronized', $7, '') ON CONFLICT (table_id) DO UPDATE SET
      descriptor_hash = excluded.descriptor_hash, descriptor_json = excluded.descriptor_json, source_package = excluded.source_package,
      source_commit = excluded.source_commit, source_module = excluded.source_module, state = 'active', synchronization_state = 'synchronized', synchronized_at = excluded.synchronized_at, error = ''`,
      [
        d.table_id,
        e.descriptor_hash,
        e.descriptor_json,
        e.source_package,
        e.source_commit,
        e.source_module,
        now(),
      ],
    );
    await this.exec(
      "UPDATE _8020_columns SET state = 'retired' WHERE table_id = $1",
      [d.table_id],
    );
    const columns = d.columns.map((c, ordinal) => {
      const encoded = JSON.stringify(c);
      return [
        d.table_id,
        c.name,
        ordinal,
        c.logical_type,
        hash(encoded),
        encoded,
        "active",
      ];
    });
    await this.insertRows(
      "_8020_columns",
      [
        "table_id",
        "column_name",
        "ordinal",
        "logical_type",
        "definition_hash",
        "definition_json",
        "state",
      ],
      columns,
      "ON CONFLICT (table_id, column_name) DO UPDATE SET ordinal = excluded.ordinal, logical_type = excluded.logical_type, definition_hash = excluded.definition_hash, definition_json = excluded.definition_json, state = 'active'",
    );
    await this.exec("DELETE FROM _8020_dependencies WHERE table_id = $1", [
      d.table_id,
    ]);
    await this.insertRows(
      "_8020_dependencies",
      ["table_id", "module_path"],
      [...new Set(e.dependencies ?? [])].map((path) => [d.table_id, path]),
    );
  }
  private async insertRows(
    table: string,
    columns: string[],
    rows: unknown[][],
    suffix = "",
  ): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += 128) {
      const values = rows.slice(offset, offset + 128),
        parameters: unknown[] = [];
      const tuples = values.map((row) =>
        `(${
          row.map((value) => {
            parameters.push(value);
            return `$${parameters.length}`;
          }).join(", ")
        })`
      );
      await this.exec(
        `INSERT INTO ${quote(table)} (${
          columns.map(quote).join(", ")
        }) VALUES ${tuples.join(", ")} ${suffix}`,
        parameters,
      );
    }
  }

  async synchronizeTable(
    e: EvaluatedTable,
    recovery: boolean,
  ): Promise<SyncResult> {
    const result: SyncResult = {
      table_id: e.descriptor.table_id,
      state: "error",
    };
    try {
      validateEvaluatedTable(e);
      await this.atomic(async () => {
        const previous = (await this.rows<
          {
            descriptor_json: string;
            source_package: string;
            source_module: string;
          }
        >(
          "SELECT descriptor_json, source_package, source_module FROM _8020_tables WHERE table_id = $1",
          [e.descriptor.table_id],
        ))[0];
        if (
          previous &&
          (previous.source_package !== e.source_package ||
            previous.source_module !== e.source_module)
        ) {
          throw new Error(
            `canonical table ID ${e.descriptor.table_id} is already owned by ${previous.source_package} at ${previous.source_module}`,
          );
        }
        if (previous) {
          result.state = "migration_required";
          await this.applyChange(
            JSON.parse(previous.descriptor_json),
            e.descriptor,
            recovery,
          );
        } else {
          const physical = await this.physicalColumns(e.descriptor.table_id);
          if (!physical.length) {
            await this.exec(createTableSQL(this.backend, e.descriptor));
            await this.ensureIndexes(e.descriptor);
          } else {
            result.state = "drift";
            const differences = comparePhysical(
              this.backend,
              e.descriptor,
              physical,
            );
            if (differences.length) {
              throw new Error(
                `uncatalogued physical table differs: ${
                  differences.join("; ")
                }`,
              );
            }
          }
        }
        result.state = "drift";
        const physical = await this.physicalColumns(e.descriptor.table_id);
        const known = new Set(
          (await this.scan<{ column_name: string }>(
            "SELECT column_name FROM _8020_columns WHERE table_id = $1 ORDER BY column_name",
            [e.descriptor.table_id],
          )).map((c) => c.column_name),
        );
        const active = new Set(e.descriptor.columns.map((c) => c.name)),
          retired = new Set([...known].filter((c) => !active.has(c)));
        const differences = comparePhysical(
          this.backend,
          e.descriptor,
          physical,
        );
        for (const c of physical) {
          if (!active.has(c.name) && !known.has(c.name)) {
            differences.push(`unexpected physical column ${c.name}`);
          }
        }
        await this.ensureIndexes(e.descriptor);
        differences.push(
          ...compareIndexes(
            e.descriptor.indexes ?? [],
            await this.physicalIndexes(e.descriptor.table_id),
            retired,
          ),
        );
        differences.push(
          ...compareChecks(
            this.backend,
            e.descriptor,
            await this.physicalChecks(e.descriptor.table_id),
            retired,
          ),
        );
        if (differences.length) throw new Error(differences.join("; "));
        result.state = "error";
        await this.writeTable(e);
      });
      result.state = "synchronized";
    } catch (error) {
      result.error = message(error);
    }
    return result;
  }
  async references(tables: EvaluatedTable[]): Promise<Map<string, string>> {
    const rows = await this.scan<
      { table_id: string; column_name: string; logical_type: string }
    >(`SELECT c.table_id, c.column_name, c.logical_type FROM _8020_columns c JOIN _8020_tables t ON t.table_id = c.table_id WHERE c.state = 'active' AND t.state = 'active' ORDER BY c.table_id, c.column_name`);
    // Candidate definitions replace the complete active column set for their table.
    const candidates = new Set(tables.map((t) => t.descriptor.table_id));
    const available = new Map(
      rows.filter((c) => !candidates.has(c.table_id)).map((
        c,
      ) => [`${c.table_id}.${c.column_name}`, c.logical_type]),
    );
    for (const table of tables) {
      for (const c of table.descriptor.columns) {
        available.set(`${table.descriptor.table_id}.${c.name}`, c.logical_type);
      }
    }
    const errors = new Map<string, string>();
    for (const table of tables) {
      for (const c of table.descriptor.columns) {
        if (!c.reference) continue;
        const target = `${c.reference.table}.${c.reference.column}`,
          type = available.get(target);
        if (!type) {
          errors.set(
            table.descriptor.table_id,
            `${table.descriptor.table_id}.${c.name} references missing column ${target}`,
          );
        } else if (type !== c.logical_type) {
          errors.set(
            table.descriptor.table_id,
            `${table.descriptor.table_id}.${c.name} type ${c.logical_type} does not match referenced ${target} type ${type}`,
          );
        }
      }
    }
    return errors;
  }
  async validateReferences(): Promise<void> {
    const rows = await this.scan<{ descriptor_json: string }>(
      "SELECT descriptor_json FROM _8020_tables WHERE state = 'active' ORDER BY table_id",
    );
    const errors = await this.references(
      rows.map(
        (
          r,
        ) => ({ descriptor: JSON.parse(r.descriptor_json) } as EvaluatedTable),
      ),
    );
    if (errors.size) throw new Error([...errors.values()].join("\n"));
  }
  async retire(ids: string[]): Promise<void> {
    for (const id of new Set(ids)) {
      if (!validTable(id)) throw new Error(`invalid retired table ID ${id}`);
      if (
        await this.exec(
          "UPDATE _8020_tables SET state = 'retired', synchronization_state = 'retired', error = '' WHERE table_id = $1",
          [id],
        ) !== 1
      ) throw new Error(`catalog table does not exist: ${id}`);
      await this.exec(
        "UPDATE _8020_columns SET state = 'retired' WHERE table_id = $1",
        [id],
      );
    }
  }
  async retireMissing(
    seen: Set<string>,
    packages: string[],
    full: boolean,
  ): Promise<void> {
    const rows = await this.scan<{ table_id: string; source_package: string }>(
      "SELECT table_id, source_package FROM _8020_tables WHERE state = 'active' ORDER BY table_id",
    );
    await this.retire(
      rows.filter((r) =>
        !seen.has(r.table_id) && (full || packages.includes(r.source_package))
      ).map((r) => r.table_id),
    );
  }
  async synchronize(
    tables: EvaluatedTable[],
    options: SyncOptions,
  ): Promise<SyncResult[]> {
    const status = await this.status();
    if (status.catalog_version !== catalogVersion || status.catalog_error) {
      throw new Error("database catalog is not ready");
    }
    const errors = options.SkipReferenceValidation
      ? new Map<string, string>()
      : await this.references(tables);
    const seen = new Set<string>(), results: SyncResult[] = [];
    for (
      const table of [...tables].sort((a, b) =>
        a.descriptor.table_id.localeCompare(b.descriptor.table_id)
      )
    ) {
      const id = table.descriptor.table_id;
      if (seen.has(id)) errors.set(id, `duplicate canonical table ID ${id}`);
      seen.add(id);
      if (errors.has(id)) {
        results.push({ table_id: id, state: "error", error: errors.get(id) });
      } else {
        results.push(
          await this.synchronizeTable(table, options.Recovery === true),
        );
      }
    }
    const failures = results.filter((r) => r.error).map((r) =>
      `${r.table_id}: ${r.error}`
    );
    if (failures.length) {
      throw new OperationFailure(failures.join("\n"), results);
    }
    if (
      options.Full || options.RetireMissingPackages?.length ||
      options.RetireTables?.length
    ) {
      try {
        await this.atomic(async () => {
          if (options.Full || options.RetireMissingPackages?.length) {
            await this.retireMissing(
              seen,
              options.RetireMissingPackages ?? [],
              options.Full === true,
            );
          }
          if (options.RetireTables?.length) {
            await this.retire(options.RetireTables);
          }
        });
      } catch (error) {
        throw new OperationFailure(message(error), results);
      }
    }
    return results;
  }
  async list(): Promise<Summary[]> {
    return await this.scan<Summary>(
      `SELECT t.*, SUM(CASE WHEN c.state = 'active' THEN 1 ELSE 0 END) AS active_columns,
      SUM(CASE WHEN c.state = 'retired' THEN 1 ELSE 0 END) AS retired_columns FROM _8020_tables t LEFT JOIN _8020_columns c ON c.table_id = t.table_id
      GROUP BY t.table_id, t.source_package, t.source_commit, t.source_module, t.state, t.synchronization_state, t.descriptor_hash, t.descriptor_json, t.synchronized_at, t.error ORDER BY t.table_id`,
    );
  }
  async inspect(id: string): Promise<Detail> {
    if (!id || id.length > 255 || id.includes("\0")) {
      throw new Error("valid table name is required");
    }
    const stored = (await this.rows<Summary & { descriptor_json: string }>(
      "SELECT * FROM _8020_tables WHERE table_id = $1",
      [id],
    ))[0];
    if (!stored && !(await this.exists(id))) {
      throw new Error("sql: no rows in result set");
    }
    const d: Detail = {
      ...stored,
      table_id: id,
      source_package: stored?.source_package ?? "",
      source_commit: stored?.source_commit ?? "",
      source_module: stored?.source_module ?? "",
      descriptor_hash: stored?.descriptor_hash ?? "",
      synchronized_at: stored?.synchronized_at ?? "",
      descriptor_json: stored?.descriptor_json ?? "",
      state: stored?.state ?? "uncatalogued",
      synchronization_state: stored?.synchronization_state ?? "uncatalogued",
      error: stored?.error ??
        "physical table is not recorded in the 80|20 catalog",
      active_columns: 0,
      retired_columns: 0,
      columns: [],
      descriptor: stored ? JSON.parse(stored.descriptor_json) : {
        format_version: 1,
        table_id: id,
        columns: [],
        primary_key: [],
        indexes: [],
      },
      physical_columns: await this.physicalColumns(id),
      physical_indexes: await this.physicalIndexes(id),
      physical_checks: await this.physicalChecks(id),
      differences: [],
    };
    if (!stored) {
      d.differences.push("uncatalogued physical table");
      return d;
    }
    d.columns = await this.scan<CatalogColumn>(
      "SELECT * FROM _8020_columns WHERE table_id = $1 ORDER BY ordinal, CASE WHEN state = 'retired' THEN 0 ELSE 1 END, column_name",
      [id],
    );
    d.active_columns = d.columns.filter((c) => c.state === "active").length;
    d.retired_columns = d.columns.length - d.active_columns;
    if (hash(d.descriptor_json) !== d.descriptor_hash) {
      d.differences.push("stored table descriptor hash differs");
    }
    const active = new Map(
      d.columns.filter((c) => c.state === "active").map(
        (c) => [c.column_name, c],
      ),
    );
    for (const c of d.descriptor.columns) {
      const found = active.get(c.name), encoded = JSON.stringify(c);
      if (!found) {
        d.differences.push(`logical catalog column ${c.name} is missing`);
      } else if (
        found.logical_type !== c.logical_type ||
        found.definition_json !== encoded ||
        found.definition_hash !== hash(encoded)
      ) d.differences.push(`logical catalog column ${c.name} differs`);
      active.delete(c.name);
    }
    for (const name of active.keys()) {
      d.differences.push(`unexpected active logical catalog column ${name}`);
    }
    const retired = new Set(
      d.columns.filter((c) => c.state === "retired").map((c) => c.column_name),
    );
    d.differences.push(
      ...comparePhysical(this.backend, d.descriptor, d.physical_columns),
      ...compareIndexes(
        d.descriptor.indexes ?? [],
        d.physical_indexes,
        retired,
      ),
      ...compareChecks(this.backend, d.descriptor, d.physical_checks, retired),
    );
    for (const name of retired) {
      if (!d.physical_columns.some((c) => c.name === name)) {
        d.differences.push(`retired physical column ${name} is missing`);
      }
    }
    for (const c of d.physical_columns) {
      if (
        !d.descriptor.columns.some((e) => e.name === c.name) &&
        !d.columns.some((e) => e.column_name === c.name)
      ) d.differences.push(`unexpected physical column ${c.name}`);
    }
    d.differences.sort();
    if (d.differences.length && d.state === "active") {
      d.synchronization_state = "drift";
    }
    return d;
  }
  async trim(id: string, columns: string[], drop: boolean): Promise<void> {
    if (!validTable(id)) throw new Error("valid table ID is required");
    await this.atomic(async () => {
      if (drop) {
        const row = await this.one<{ state: string }>(
          "SELECT state FROM _8020_tables WHERE table_id = $1",
          [id],
        );
        if (row.state !== "retired") {
          throw new Error("only retired tables may be trimmed");
        }
        await this.exec(`DROP TABLE ${quote(id)}`);
        for (
          const table of ["_8020_dependencies", "_8020_columns", "_8020_tables"]
        ) await this.exec(`DELETE FROM ${table} WHERE table_id = $1`, [id]);
        return;
      }
      for (const column of columns) {
        if (!validColumn(column)) throw new Error(`invalid column ${column}`);
        const row = await this.one<{ state: string }>(
          "SELECT state FROM _8020_columns WHERE table_id = $1 AND column_name = $2",
          [id, column],
        );
        if (row.state !== "retired") {
          throw new Error(`column ${column} is not retired`);
        }
        if (this.backend === "sqlite") {
          for (const index of await this.physicalIndexes(id)) {
            if (index.columns.includes(column)) {
              await this.exec(`DROP INDEX ${quote(index.name)}`);
            }
          }
        }
        await this.exec(
          `ALTER TABLE ${quote(id)} DROP COLUMN ${quote(column)}`,
        );
        await this.exec(
          "DELETE FROM _8020_columns WHERE table_id = $1 AND column_name = $2",
          [id, column],
        );
      }
    });
  }
  async run(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const id = String(input.id ?? "");
    switch (operation) {
      case "initialize":
        await this.initialize();
        return null;
      case "status":
        return await this.status();
      case "beginInitialization":
        await this.atomic(async () => {
          await this.exec(
            "UPDATE _8020_catalog SET last_error = '' WHERE catalog_id = 'system'",
          );
        });
        return null;
      case "catalogState":
        return await this.catalogState();
      case "completeInitialization":
        await this.completeInitialization(input.commits as Commits);
        return null;
      case "failure":
        await this.exec(
          "UPDATE _8020_catalog SET last_error = $1, updated_at = $2 WHERE catalog_id = 'system'",
          [input.error, now()],
        );
        return null;
      case "beginDeployment":
        return await this.beginDeployment(id, input.candidates as Candidate[]);
      case "completeDeployment":
        await this.completeDeployment(id, input.activated === true);
        return null;
      case "pending":
        return await this.pending(id);
      case "updatePending":
        if (!input.stage) {
          throw new Error("database deployment stage is required");
        }
        await this.atomic(async () => {
          if (
            await this.exec(
              "UPDATE _8020_pending_deployment SET stage = $1, error = $2, updated_at = $3 WHERE deployment_id = $4",
              [input.stage, input.error ?? "", now(), id],
            ) !== 1
          ) throw new Error("database schema deployment is not pending");
        });
        return null;
      case "sources": {
        const result = new Map<string, Row>();
        for (const value of input.values as string[] ?? []) {
          const rows = await this.scan(
            input.dependencies
              ? "SELECT t.table_id, t.source_package, t.source_commit, t.source_module FROM _8020_dependencies d JOIN _8020_tables t ON t.table_id = d.table_id WHERE d.module_path = $1 AND t.state = 'active' ORDER BY t.table_id"
              : "SELECT table_id, source_package, source_commit, source_module FROM _8020_tables WHERE source_package = $1 AND state = 'active' ORDER BY table_id",
            [value],
          );
          for (const row of rows) {
            result.set(String(row.table_id), {
              TableID: row.table_id,
              SourcePackage: row.source_package,
              SourceCommit: row.source_commit,
              SourceModule: row.source_module,
            });
          }
        }
        return [...result.values()].sort((a, b) =>
          String(a.TableID).localeCompare(String(b.TableID))
        );
      }
      case "source": {
        if (!validTable(id)) throw new Error("valid table ID is required");
        const row =
          (await this.rows<{ source_package: string; source_module: string }>(
            "SELECT source_package, source_module FROM _8020_tables WHERE table_id = $1",
            [id],
          ))[0];
        const source = row?.source_package || input.package;
        if (!source) {
          throw new Error(
            "source package is required for a new table definition",
          );
        }
        return {
          TableID: id,
          SourcePackage: source,
          SourceModule: row?.source_module ?? "",
        };
      }
      case "completed": {
        const result: Record<string, boolean> = {};
        for (const [id, commit] of Object.entries(input.commits as Commits)) {
          for (
            const row of await this.scan<{ table_id: string }>(
              "SELECT table_id FROM _8020_tables WHERE source_package = $1 AND source_commit = $2 AND state = 'active' AND synchronization_state = 'synchronized' ORDER BY table_id",
              [id, commit],
            )
          ) result[row.table_id] = true;
        }
        return result;
      }
      case "synchronize":
        return await this.synchronize(
          input.tables as EvaluatedTable[] ?? [],
          input.options as SyncOptions ?? {},
        );
      case "finalize": {
        const ids = input.ids as string[] ?? [];
        if (
          ids.some((id) => !validTable(id)) || new Set(ids).size !== ids.length
        ) throw new Error("invalid or duplicate table ID");
        await this.atomic(async () => {
          await this.retireMissing(new Set(ids), [], true);
          await this.validateReferences();
        });
        return null;
      }
      case "references":
        await this.validateReferences();
        return null;
      case "list":
        return await this.list();
      case "inspect":
        return await this.inspect(id);
      case "trim":
        await this.trim(
          id,
          input.columns as string[] ?? [],
          input.drop === true,
        );
        return null;
      case "definitions": {
        const catalog = await this.list(),
          stored = new Map(catalog.map((t) => [t.table_id, t]));
        const result: Row[] = [];
        for (const table of input.tables as EvaluatedTable[] ?? []) {
          const old = stored.get(table.descriptor.table_id);
          stored.delete(table.descriptor.table_id);
          if (
            old?.state === "active" &&
            old.descriptor_hash === table.descriptor_hash &&
            old.source_commit === table.source_commit
          ) continue;
          result.push({
            table_id: table.descriptor.table_id,
            source_package: table.source_package,
            source_commit: table.source_commit,
            source_module: table.source_module,
            descriptor_hash: table.descriptor_hash,
            catalog_state: old?.state ?? "",
            catalog_hash: old?.descriptor_hash ?? "",
            synchronization_state: !old ? "new" : old.state === "active" &&
                old.descriptor_hash === table.descriptor_hash
              ? "source_commit_mismatch"
              : "changed",
          });
        }
        for (const old of stored.values()) {
          if (old.state === "active" && old.source_package) {
            result.push({
              ...old,
              descriptor_hash: "",
              catalog_state: old.state,
              catalog_hash: old.descriptor_hash,
              synchronization_state: "deleted",
            });
          }
        }
        return result.sort((a, b) =>
          String(a.table_id).localeCompare(String(b.table_id))
        );
      }
      case "compare": {
        const detail = input.detail as unknown as Detail,
          current = input.current as EvaluatedTable | null;
        if (!detail.source_package) detail.definition_state = "unknown";
        else if (input.error) {
          detail.definition_state = "error";
          detail.error = [detail.error, input.error].filter(Boolean).join("; ");
          detail.differences.push(
            `activated definition is invalid: ${input.error}`,
          );
        } else if (!current) {
          detail.definition_state = "missing";
          detail.differences.push("activated definition file is missing");
        } else {
          detail.current_descriptor = current.descriptor;
          detail.current_descriptor_hash = current.descriptor_hash;
          detail.current_source_commit = current.source_commit;
          detail.definition_state = "present";
          if (current.descriptor_hash !== detail.descriptor_hash) {
            detail.definition_state = "changed";
            detail.differences.push(
              "activated definition differs from deployed descriptor",
            );
          } else if (current.source_commit !== detail.source_commit) {
            detail.definition_state = "commit_mismatch";
            detail.differences.push(
              "activated package commit differs from catalog source commit",
            );
          }
        }
        detail.differences.sort();
        if (detail.differences.length && detail.state === "active") {
          detail.synchronization_state = "drift";
        }
        return detail;
      }
      default:
        throw new Error(`unknown schema operation ${operation}`);
    }
  }
}

export default async function schema(
  request: SchemaRequest,
): Promise<{ value: unknown; error?: string; status?: Row }> {
  const store = new Schema(
    kernelDatabaseBackend() as Backend,
    request.publication_lock_held === true,
  );
  let value: unknown = null, error: string | undefined;
  try {
    value = await store.run(request.operation, request.input ?? {});
  } catch (failure) {
    error = message(failure);
    if (failure instanceof OperationFailure) value = failure.value;
  }
  const statusOperations = [
    "initialize",
    "completeInitialization",
    "beginDeployment",
    "completeDeployment",
    "failure",
  ];
  const status = statusOperations.includes(request.operation) && !error
    ? await store.status()
    : undefined;
  return { value, error, status };
}
