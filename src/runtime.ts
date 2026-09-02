import {
  type AbortableOperationOptions,
  type CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type Driver,
  Kysely,
  type KyselyPlugin,
  type OperationNode,
  OperationNodeTransformer,
  PostgresAdapter,
  PostgresQueryCompiler,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  SqliteAdapter,
  SqliteQueryCompiler,
  type TransactionSettings,
  type UnknownRow,
} from "kysely";
import {
  type DatabaseBackend,
  kernelDatabaseBackend,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import type { Database } from "../types.ts";
import {
  type DatabaseValue,
  decodeDatabaseValue,
  encodeDatabaseValue,
  logicalValue,
  scaledToDecimal,
} from "./values.ts";
import {
  type ColumnDescriptor,
  registeredTable,
  type TableDescriptor,
} from "./descriptor.ts";

interface ExecuteResult {
  columns: string[];
  rows: DatabaseValue[][];
  affected_rows?: DatabaseValue;
  insert_id?: DatabaseValue;
}

interface KernelDatabaseAPI {
  execute(input: {
    statement: string;
    parameters: DatabaseValue[];
    return_rows: boolean;
    transaction?: string;
  }): Promise<ExecuteResult>;
  transaction: {
    begin(settings: TransactionSettings): Promise<{ transaction: string }>;
    commit(transaction: string): Promise<void>;
    rollback(transaction: string): Promise<void>;
  };
}

function invoke<Result>(
  operation: string,
  input: Record<string, unknown> = {},
): Promise<Result> {
  const bridge = (globalThis as unknown as Record<symbol, unknown>)[
    kernelInvokeSymbol
  ];
  if (typeof bridge !== "function") {
    return Promise.reject(new Error("kernel database API is unavailable"));
  }
  return (bridge as (
    operation: string,
    input: Record<string, unknown>,
  ) => Promise<Result>)(operation, input);
}

const databaseAPI: KernelDatabaseAPI = {
  execute: (input) => invoke("database.execute", input),
  transaction: {
    begin: (settings) => invoke("database.transaction.begin", { settings }),
    commit: (transaction) =>
      invoke("database.transaction.commit", { transaction }),
    rollback: (transaction) =>
      invoke("database.transaction.rollback", { transaction }),
  },
};
export function getDatabase(): Kysely<Database> {
  return activeDatabase;
}

class RemoteConnection implements DatabaseConnection {
  transaction?: string;

  async executeQuery<Row>(compiled: CompiledQuery): Promise<QueryResult<Row>> {
    const result = await databaseAPI.execute({
      statement: compiled.sql,
      parameters: compiled.parameters.map((value) =>
        encodeDatabaseValue(value)
      ),
      return_rows: returnsRows(compiled),
      ...(this.transaction === undefined
        ? {}
        : { transaction: this.transaction }),
    });
    const rows = result.rows.map((values) =>
      Object.fromEntries(
        result.columns.map((column, index) => [
          column,
          decodeDatabaseValue(values[index] ?? null),
        ]),
      ) as Row
    );
    const affected = result.affected_rows === undefined
      ? undefined
      : decodeDatabaseValue(result.affected_rows);
    const insert = result.insert_id === undefined
      ? undefined
      : decodeDatabaseValue(result.insert_id);
    return {
      rows,
      ...(typeof affected === "bigint" ? { numAffectedRows: affected } : {}),
      ...(typeof insert === "bigint" ? { insertId: insert } : {}),
    };
  }

  // deno-lint-ignore require-yield
  async *streamQuery<Row>(): AsyncIterableIterator<QueryResult<Row>> {
    throw new Error(
      "database streaming is not implemented; paginate the query",
    );
  }
}

function returnsRows(compiled: CompiledQuery): boolean {
  const query = compiled.query as unknown as {
    kind?: string;
    returning?: unknown;
    output?: unknown;
  };
  return query.kind === "SelectQueryNode" || query.kind === "ExplainNode" ||
    query.kind === "RawNode" ||
    query.returning !== undefined || query.output !== undefined;
}

class RemoteDriver implements Driver {
  init(_options?: AbortableOperationOptions): Promise<void> {
    return Promise.resolve();
  }

  acquireConnection(
    _options?: AbortableOperationOptions,
  ): Promise<DatabaseConnection> {
    return Promise.resolve(new RemoteConnection());
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    const remote = connection as RemoteConnection;
    if (remote.transaction !== undefined) {
      throw new Error("transaction already active");
    }
    remote.transaction =
      (await databaseAPI.transaction.begin(settings)).transaction;
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    const remote = connection as RemoteConnection;
    if (remote.transaction === undefined) {
      throw new Error("transaction is not active");
    }
    const transaction = remote.transaction;
    remote.transaction = undefined;
    await databaseAPI.transaction.commit(transaction);
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    const remote = connection as RemoteConnection;
    if (remote.transaction === undefined) return;
    const transaction = remote.transaction;
    remote.transaction = undefined;
    await databaseAPI.transaction.rollback(transaction);
  }

  releaseConnection(
    connection: DatabaseConnection,
    _options?: AbortableOperationOptions,
  ): Promise<void> {
    if ((connection as RemoteConnection).transaction !== undefined) {
      return Promise.reject(
        new Error("cannot release an active database transaction"),
      );
    }
    return Promise.resolve();
  }

  destroy(_options?: AbortableOperationOptions): Promise<void> {
    return Promise.resolve();
  }
}

class EmptyIntrospector implements DatabaseIntrospector {
  getSchemas(): Promise<[]> {
    return Promise.resolve([]);
  }

  getTables(): Promise<[]> {
    return Promise.resolve([]);
  }
}

class RemoteDialect implements Dialect {
  readonly #backend: DatabaseBackend;

  constructor(backend: DatabaseBackend) {
    this.#backend = backend;
  }

  createDriver(): Driver {
    return new RemoteDriver();
  }

  createQueryCompiler(): SqliteQueryCompiler | PostgresQueryCompiler {
    return this.#backend === "sqlite"
      ? new SqliteQueryCompiler()
      : new PostgresQueryCompiler();
  }

  createAdapter(): SqliteAdapter | PostgresAdapter {
    return this.#backend === "sqlite"
      ? new SqliteAdapter()
      : new PostgresAdapter();
  }

  createIntrospector(): DatabaseIntrospector {
    return new EmptyIntrospector();
  }
}

interface Node extends OperationNode {
  readonly [key: string]: unknown;
}

function node(value: unknown): Node | undefined {
  return value !== null && typeof value === "object" &&
      typeof (value as { kind?: unknown }).kind === "string"
    ? value as Node
    : undefined;
}

function identifier(value: unknown): string | undefined {
  const item = node(value);
  return item?.kind === "IdentifierNode" && typeof item.name === "string"
    ? item.name
    : undefined;
}

function tableName(value: unknown): string | undefined {
  const item = node(value);
  if (item?.kind !== "TableNode") return undefined;
  const table = node(item.table);
  return table?.kind === "SchemableIdentifierNode"
    ? identifier(table.identifier)
    : undefined;
}

function tableSource(
  value: unknown,
): { name: string; alias: string } | undefined {
  const item = node(value);
  if (item?.kind === "AliasNode") {
    const name = tableName(item.node);
    const alias = identifier(item.alias);
    return name !== undefined && alias !== undefined
      ? { name, alias }
      : undefined;
  }
  const name = tableName(item);
  return name === undefined ? undefined : { name, alias: name };
}

function columnName(value: unknown): string | undefined {
  const item = node(value);
  if (item?.kind === "ColumnNode") return identifier(item.column);
  if (item?.kind === "ReferenceNode") return columnName(item.column);
  return undefined;
}

function reference(
  value: unknown,
): { table?: string; column: string } | undefined {
  const item = node(value);
  if (item?.kind !== "ReferenceNode") return undefined;
  const column = columnName(item.column);
  if (column === undefined) return undefined;
  const table = tableName(item.table);
  return { ...(table === undefined ? {} : { table }), column };
}

function querySources(root: RootOperationNode): Map<string, TableDescriptor> {
  const sources = new Map<string, TableDescriptor>();
  const add = (value: unknown) => {
    const source = tableSource(value);
    const descriptor = source === undefined
      ? undefined
      : registeredTable(source.name);
    if (source !== undefined && descriptor !== undefined) {
      sources.set(source.alias, descriptor);
      sources.set(source.name, descriptor);
    }
  };
  const item = root as unknown as Node;
  if (item.kind === "InsertQueryNode") add(item.into);
  if (item.kind === "UpdateQueryNode") add(item.table);
  const from = node(item.from);
  if (from?.kind === "FromNode" && Array.isArray(from.froms)) {
    for (const source of from.froms) add(source);
  }
  if (Array.isArray(item.joins)) {
    for (const joinValue of item.joins) {
      const join = node(joinValue);
      if (join?.kind === "JoinNode") add(join.table);
    }
  }
  return sources;
}

function descriptorColumn(
  descriptor: TableDescriptor | undefined,
  name: string,
): ColumnDescriptor | undefined {
  return descriptor?.columns.find((column) => column.name === name);
}

function resolveColumn(
  value: unknown,
  sources: Map<string, TableDescriptor>,
): ColumnDescriptor | undefined {
  const selected = reference(value);
  if (selected === undefined) return undefined;
  if (selected.table !== undefined) {
    return descriptorColumn(
      sources.get(selected.table) ?? registeredTable(selected.table),
      selected.column,
    );
  }
  const candidates = new Set<ColumnDescriptor>();
  for (const descriptor of new Set(sources.values())) {
    const column = descriptorColumn(descriptor, selected.column);
    if (column !== undefined) candidates.add(column);
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function encodeNodeValue(value: unknown, column: ColumnDescriptor): unknown {
  const item = node(value);
  if (item?.kind === "ValueNode" && item.immediate !== true) {
    return {
      ...item,
      value: logicalValue(
        item.value,
        column.logical_type,
        column.precision,
        column.scale,
      ),
    };
  }
  if (item?.kind === "PrimitiveValueListNode" && Array.isArray(item.values)) {
    return {
      ...item,
      values: item.values.map((entry) =>
        logicalValue(
          entry,
          column.logical_type,
          column.precision,
          column.scale,
        )
      ),
    };
  }
  if (item?.kind === "ValueListNode" && Array.isArray(item.values)) {
    return {
      ...item,
      values: item.values.map((entry) => encodeNodeValue(entry, column)),
    };
  }
  return value;
}

class CodecTransformer extends OperationNodeTransformer {
  readonly #sources: Map<string, TableDescriptor>;
  #insertColumns: Array<ColumnDescriptor | undefined> | undefined;
  #updateTable: TableDescriptor | undefined;

  constructor(root: RootOperationNode) {
    super();
    this.#sources = querySources(root);
  }

  protected override transformInsertQuery(
    value: import("kysely").InsertQueryNode,
    queryId?: QueryId,
  ): import("kysely").InsertQueryNode {
    const previous = this.#insertColumns;
    const descriptor = registeredTable(tableName(value.into) ?? "");
    this.#insertColumns = value.columns?.map((column) =>
      descriptorColumn(descriptor, columnName(column) ?? "")
    );
    const result = super.transformInsertQuery(value, queryId);
    this.#insertColumns = previous;
    return result;
  }

  protected override transformPrimitiveValueList(
    value: import("kysely").PrimitiveValueListNode,
  ): import("kysely").PrimitiveValueListNode {
    if (this.#insertColumns === undefined) return value;
    return {
      ...value,
      values: value.values.map((entry, index) => {
        const column = this.#insertColumns?.[index];
        return column === undefined ? entry : logicalValue(
          entry,
          column.logical_type,
          column.precision,
          column.scale,
        );
      }),
    };
  }

  protected override transformValueList(
    value: import("kysely").ValueListNode,
    queryId?: QueryId,
  ): import("kysely").ValueListNode {
    if (this.#insertColumns === undefined) {
      return super.transformValueList(value, queryId);
    }
    return {
      ...value,
      values: value.values.map((entry, index) => {
        const transformed = this.transformNode(entry, queryId);
        const column = this.#insertColumns?.[index];
        return column === undefined
          ? transformed
          : encodeNodeValue(transformed, column) as OperationNode;
      }),
    };
  }

  protected override transformUpdateQuery(
    value: import("kysely").UpdateQueryNode,
    queryId?: QueryId,
  ): import("kysely").UpdateQueryNode {
    const previous = this.#updateTable;
    const source = tableSource(value.table);
    this.#updateTable = source === undefined
      ? undefined
      : registeredTable(source.name);
    const result = super.transformUpdateQuery(value, queryId);
    this.#updateTable = previous;
    return result;
  }

  protected override transformColumnUpdate(
    value: import("kysely").ColumnUpdateNode,
    queryId?: QueryId,
  ): import("kysely").ColumnUpdateNode {
    const result = super.transformColumnUpdate(value, queryId);
    const column = descriptorColumn(
      this.#updateTable,
      columnName(result.column) ?? "",
    );
    return column === undefined ? result : {
      ...result,
      value: encodeNodeValue(result.value, column) as OperationNode,
    };
  }

  protected override transformBinaryOperation(
    value: import("kysely").BinaryOperationNode,
    queryId?: QueryId,
  ): import("kysely").BinaryOperationNode {
    const result = super.transformBinaryOperation(value, queryId);
    const left = resolveColumn(result.leftOperand, this.#sources);
    const right = resolveColumn(result.rightOperand, this.#sources);
    if (left !== undefined) {
      return {
        ...result,
        rightOperand: encodeNodeValue(
          result.rightOperand,
          left,
        ) as OperationNode,
      };
    }
    if (right !== undefined) {
      return {
        ...result,
        leftOperand: encodeNodeValue(
          result.leftOperand,
          right,
        ) as OperationNode,
      };
    }
    return result;
  }
}

type ResultCodecs = Map<string, ColumnDescriptor>;

function resultCodecs(root: RootOperationNode): ResultCodecs {
  const item = root as unknown as Node;
  const sources = querySources(root);
  let selections: readonly unknown[] | undefined;
  if (Array.isArray(item.selections)) selections = item.selections;
  const returning = node(item.returning);
  if (
    returning?.kind === "ReturningNode" && Array.isArray(returning.selections)
  ) {
    selections = returning.selections;
  }
  const codecs: ResultCodecs = new Map();
  for (const selectionValue of selections ?? []) {
    const selection = node(selectionValue);
    if (selection?.kind !== "SelectionNode") continue;
    const selected = node(selection.selection);
    if (selected?.kind === "SelectAllNode") {
      for (const descriptor of new Set(sources.values())) {
        for (const column of descriptor.columns) {
          const existing = codecs.get(column.name);
          if (
            existing === undefined ||
            (existing.logical_type === column.logical_type &&
              existing.precision === column.precision &&
              existing.scale === column.scale)
          ) codecs.set(column.name, column);
          else codecs.delete(column.name);
        }
      }
      continue;
    }
    if (
      selected?.kind === "ReferenceNode" &&
      node(selected.column)?.kind === "SelectAllNode"
    ) {
      const sourceName = tableName(selected.table);
      const descriptor = sourceName === undefined
        ? undefined
        : sources.get(sourceName) ?? registeredTable(sourceName);
      for (const column of descriptor?.columns ?? []) {
        codecs.set(column.name, column);
      }
      continue;
    }
    if (selected?.kind === "AliasNode") {
      const output = identifier(selected.alias);
      const column = resolveColumn(selected.node, sources);
      if (output !== undefined && column !== undefined) {
        codecs.set(output, column);
      }
      continue;
    }
    const selectedReference = reference(selected);
    const column = resolveColumn(selected, sources);
    if (selectedReference !== undefined && column !== undefined) {
      codecs.set(selectedReference.column, column);
    }
  }
  return codecs;
}

function decodeLogicalValue(value: unknown, column: ColumnDescriptor): unknown {
  if (value === null) return value;
  switch (column.logical_type) {
    case "text":
    case "enum":
      if (typeof value !== "string") {
        throw new TypeError(`invalid ${column.logical_type} result`);
      }
      return value;
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === 0 || value === 0n) return false;
      if (value === 1 || value === 1n) return true;
      throw new TypeError("invalid boolean result");
    case "integer": {
      const integer = typeof value === "bigint"
        ? value
        : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : undefined;
      if (
        integer === undefined || integer < BigInt(Number.MIN_SAFE_INTEGER) ||
        integer > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new RangeError(
          "integer result exceeds JavaScript safe integer range",
        );
      }
      return Number(integer);
    }
    case "float":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("invalid float result");
      }
      return value;
    case "decimal": {
      const scaled = typeof value === "bigint"
        ? value
        : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : undefined;
      if (scaled === undefined) throw new TypeError("invalid decimal result");
      return scaledToDecimal(scaled, column.scale ?? 0);
    }
    case "datetime": {
      if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value;
      }
      if (typeof value !== "string") {
        throw new TypeError("invalid datetime result");
      }
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) {
        throw new TypeError("invalid datetime result");
      }
      return date;
    }
    case "bytes":
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("invalid bytes result");
      }
      return value;
    case "json":
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        throw new TypeError("invalid JSON result");
      }
  }
}

class PlatformCodecPlugin implements KyselyPlugin {
  readonly #results = new WeakMap<QueryId, ResultCodecs>();

  transformQuery(
    args: { queryId: QueryId; node: RootOperationNode },
  ): RootOperationNode {
    this.#results.set(args.queryId, resultCodecs(args.node));
    return new CodecTransformer(args.node).transformNode(
      args.node,
      args.queryId,
    );
  }

  transformResult(args: {
    queryId: QueryId;
    result: QueryResult<UnknownRow>;
  }): Promise<QueryResult<UnknownRow>> {
    const codecs = this.#results.get(args.queryId);
    if (codecs === undefined || codecs.size === 0) {
      return Promise.resolve(args.result);
    }
    return Promise.resolve({
      ...args.result,
      rows: args.result.rows.map((row) => {
        const decoded: UnknownRow = { ...row };
        for (const [name, column] of codecs) {
          if (Object.hasOwn(decoded, name)) {
            decoded[name] = decodeLogicalValue(decoded[name], column);
          }
        }
        return decoded;
      }),
    });
  }
}

/** Internal test seam; application code should use the exported singleton. */
export function createDatabase(
  backend: DatabaseBackend,
): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new RemoteDialect(backend),
    plugins: [new PlatformCodecPlugin()],
  });
}

const activeDatabase = createDatabase(kernelDatabaseBackend());
export const db = activeDatabase;
