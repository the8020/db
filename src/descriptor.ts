import type {
  ColumnType,
  DeleteQueryBuilder,
  DeleteResult,
  Insertable,
  InsertQueryBuilder,
  InsertResult,
  Selectable,
  SelectExpression,
  Selection,
  SelectQueryBuilder,
  Updateable,
  UpdateQueryBuilder,
  UpdateResult,
} from "/p/the8020/db/kysely.ts";
import type { Database } from "../types.ts";
import type {
  ColumnDescriptor,
  DefaultDescriptor,
  IndexDescriptor,
  JSONValue,
  LogicalType,
  TableDescriptor,
} from "./schema.ts";
export type {
  ColumnDescriptor,
  DefaultDescriptor,
  IndexDescriptor,
  JSONValue,
  LogicalType,
  ReferenceDescriptor,
  TableDescriptor,
} from "./schema.ts";
import {
  fieldMetadata,
  fieldSchemas,
  type FieldStorage,
  z,
} from "../fields.ts";
import { getDatabase } from "./runtime.ts";
import {
  assertDecimal,
  assertDecimalDefinition,
  assertFiniteFloat,
  assertSafeInteger,
  bytesToBase64,
  normalizedEnumValues,
} from "./values.ts";

export const tableDescriptorSymbol = Symbol.for("the8020.db.table-descriptor");
declare const tableTypesSymbol: unique symbol;

interface ColumnState {
  logicalType: LogicalType;
  precision?: number;
  scale?: number;
  enumValues?: readonly string[];
  nullable: boolean;
  default?: DefaultDescriptor;
  generated: boolean;
  primaryKey: boolean;
  unique: boolean;
  reference?: () => string;
}

export class ColumnDefinition<Select, Insert = Select, Update = Select> {
  readonly #state: ColumnState;

  constructor(state: ColumnState) {
    this.#state = state;
  }

  nullable(): ColumnDefinition<
    Select | null,
    Insert | null,
    Update | null
  > {
    return this.#copy({ nullable: true });
  }

  default(value: Insert): ColumnDefinition<Select, Insert | undefined, Update> {
    return this.#copy({ default: literalDefault(this.#state, value) });
  }

  defaultNow(): ColumnDefinition<Select, Insert | undefined, Update> {
    if (this.#state.logicalType !== "datetime") {
      throw new TypeError("defaultNow() is valid only for datetime columns");
    }
    return this.#copy({ default: { kind: "now" } });
  }

  generated(): ColumnDefinition<Select, Insert | undefined, Update> {
    return this.#copy({ generated: true });
  }

  primaryKey(): ColumnDefinition<Select, Insert, Update> {
    return this.#copy({ primaryKey: true });
  }

  unique(): ColumnDefinition<Select, Insert, Update> {
    return this.#copy({ unique: true });
  }

  references(
    reference: () => string,
  ): ColumnDefinition<Select, Insert, Update> {
    if (typeof reference !== "function") {
      throw new TypeError("references() requires a column reference function");
    }
    return this.#copy({ reference });
  }

  descriptor(name: string): ColumnDescriptor {
    const reference = this.#state.reference?.();
    const split = reference?.lastIndexOf(".") ?? -1;
    if (reference !== undefined && split < 1) {
      throw new TypeError(
        `invalid referenced column ${JSON.stringify(reference)}`,
      );
    }
    return {
      name,
      logical_type: this.#state.logicalType,
      ...(this.#state.precision === undefined
        ? {}
        : { precision: this.#state.precision }),
      ...(this.#state.scale === undefined ? {} : { scale: this.#state.scale }),
      ...(this.#state.enumValues === undefined
        ? {}
        : { enum_values: [...this.#state.enumValues] }),
      nullable: this.#state.nullable,
      ...(this.#state.default === undefined
        ? {}
        : { default: structuredClone(this.#state.default) }),
      generated: this.#state.generated,
      primary_key: this.#state.primaryKey,
      unique: this.#state.unique,
      ...(reference === undefined ? {} : {
        reference: {
          table: reference.slice(0, split),
          column: reference.slice(split + 1),
        },
      }),
    };
  }

  #copy<NextSelect = Select, NextInsert = Insert, NextUpdate = Update>(
    patch: Partial<ColumnState>,
  ): ColumnDefinition<NextSelect, NextInsert, NextUpdate> {
    return new ColumnDefinition({ ...this.#state, ...patch });
  }
}

type AnyColumn = ColumnDefinition<unknown, unknown, unknown>;
type ColumnMap = Record<string, AnyColumn>;
type ColumnRow<Columns extends ColumnMap> = {
  [Name in keyof Columns]: Columns[Name] extends ColumnDefinition<
    infer Select,
    infer Insert,
    infer Update
  > ? ColumnType<Select, Insert, Update>
    : never;
};

export type Row<Table extends AnyTable> = Table extends {
  readonly [tableTypesSymbol]?: infer Columns extends ColumnMap;
} ? ColumnRow<Columns>
  : never;

export type TableDatabase<Table extends AnyTable> = Record<
  Table["table"],
  Row<Table>
>;

type LocalDatabase<ID extends string, Columns extends ColumnMap> = Record<
  ID,
  ColumnRow<Columns>
>;
type AvailableDatabase<ID extends string, Columns extends ColumnMap> =
  & Database
  & LocalDatabase<ID, Columns>;

// The frozen table object receives its precise public Kysely types at the
// return boundary below. Keep its runtime forwarding deliberately untyped so
// the compiler does not expand the complete augmented Database union once for
// every installed table during batch evaluation.
interface RuntimeDatabase {
  selectFrom(table: string): {
    select(selection: readonly string[]): unknown;
    selectAll(): unknown;
  };
  insertInto(table: string): {
    values(
      value:
        | Readonly<Record<string, unknown>>
        | readonly Readonly<Record<string, unknown>>[],
    ): unknown;
  };
  updateTable(table: string): {
    set(value: Readonly<Record<string, unknown>>): unknown;
  };
  deleteFrom(table: string): unknown;
}

type QualifiedColumns<ID extends string, Columns extends ColumnMap> = {
  readonly [Name in keyof Columns]: `${ID}.${Extract<Name, string>}`;
};

export interface TableIndex<Columns extends ColumnMap> {
  name?: string;
  columns: readonly (keyof Columns & string)[];
  unique?: boolean;
}

export interface TableOptions<Columns extends ColumnMap> {
  indexes?: readonly TableIndex<Columns>[];
}

export type TableObject<
  ID extends string,
  Columns extends ColumnMap,
> = QualifiedColumns<ID, Columns> & {
  readonly table: ID;
  readonly [tableDescriptorSymbol]: TableDescriptor;
  readonly [tableTypesSymbol]?: Columns;
  select<
    SelectionExpression extends SelectExpression<
      AvailableDatabase<ID, Columns>,
      ID
    >,
  >(
    selection: readonly SelectionExpression[],
  ): SelectQueryBuilder<
    AvailableDatabase<ID, Columns>,
    ID,
    Selection<AvailableDatabase<ID, Columns>, ID, SelectionExpression>
  >;
  selectAll(): SelectQueryBuilder<
    AvailableDatabase<ID, Columns>,
    ID,
    Selectable<ColumnRow<Columns>>
  >;
  insert(
    values:
      | Insertable<ColumnRow<Columns>>
      | readonly Insertable<ColumnRow<Columns>>[],
  ): InsertQueryBuilder<AvailableDatabase<ID, Columns>, ID, InsertResult>;
  update(
    values: Updateable<ColumnRow<Columns>>,
  ): UpdateQueryBuilder<
    AvailableDatabase<ID, Columns>,
    ID,
    ID,
    UpdateResult
  >;
  delete(): DeleteQueryBuilder<
    AvailableDatabase<ID, Columns>,
    ID,
    DeleteResult
  >;
};

export type AnyTable = {
  readonly table: string;
  readonly [tableDescriptorSymbol]: TableDescriptor;
  readonly [tableTypesSymbol]?: ColumnMap;
};

const portableColumn = /^[A-Za-z_][A-Za-z0-9_]*$/;
const portableTableComponent = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const reservedColumns = new Set([
  "table",
  "select",
  "selectAll",
  "insert",
  "update",
  "delete",
]);
const tableRegistry = new Map<string, TableDescriptor>();

export function columns<Shape extends z.ZodRawShape>(
  definitions: z.ZodObject<Shape>,
): { [Name in keyof Shape]: ColumnDefinition<z.output<Shape[Name]>> };
export function columns<const Columns extends ColumnMap>(
  definitions: Columns,
): Columns;
export function columns(
  definitions: ColumnMap | z.ZodObject<z.ZodRawShape>,
): ColumnMap {
  if (!(definitions instanceof z.ZodObject)) return definitions;
  return Object.fromEntries(
    Object.entries(definitions.shape).map(([name, schema]) => [
      name,
      columnFromSchema(schema as z.ZodType),
    ]),
  );
}

export function table<
  const ID extends string,
  const Columns extends ColumnMap,
>(
  id: ID,
  definitions: Columns,
  options: TableOptions<Columns> = {},
): TableObject<ID, Columns> {
  if (!portableTableId(id)) {
    throw new TypeError(`invalid canonical table ID ${JSON.stringify(id)}`);
  }
  const names = Object.keys(definitions);
  for (const name of names) {
    if (
      !portableColumn.test(name) || reservedColumns.has(name) ||
      new TextEncoder().encode(name).length > 63
    ) {
      throw new TypeError(
        `invalid or reserved column name ${JSON.stringify(name)}`,
      );
    }
    if (!(definitions[name] instanceof ColumnDefinition)) {
      throw new TypeError(
        `column ${JSON.stringify(name)} is not an 80|20 column`,
      );
    }
  }
  const descriptorColumns = names.map((name) =>
    definitions[name]!.descriptor(name)
  );
  const primaryKey = descriptorColumns.filter((column) => column.primary_key)
    .map((column) => column.name);
  const generated = descriptorColumns.filter((column) => column.generated);
  if (
    generated.some((column) =>
      generated.length !== 1 || primaryKey.length !== 1 ||
      column.logical_type !== "integer" || !column.primary_key
    )
  ) {
    throw new TypeError(
      "generated() requires one generated integer column that is the single-column primary key",
    );
  }
  const indexNames = new Set<string>();
  const indexes: IndexDescriptor[] = [];
  for (const column of descriptorColumns) {
    if (column.unique) {
      indexes.push({
        name: shortIdentifier(`${id}__${column.name}__unique`),
        columns: [column.name],
        unique: true,
      });
    }
  }
  for (const index of options.indexes ?? []) {
    if (!Array.isArray(index.columns) || index.columns.length === 0) {
      throw new TypeError("table index requires at least one column");
    }
    const indexColumns = index.columns.map(String);
    for (const name of indexColumns) {
      if (!names.includes(name)) {
        throw new TypeError(
          `index references unknown column ${JSON.stringify(name)}`,
        );
      }
    }
    const generatedName = `${id}__${indexColumns.join("_")}__${
      index.unique ? "unique" : "index"
    }`;
    const name = index.name ?? shortIdentifier(generatedName);
    if (
      !portableColumn.test(name) || new TextEncoder().encode(name).length > 63
    ) {
      throw new TypeError(`invalid index name ${JSON.stringify(name)}`);
    }
    indexes.push({
      name,
      columns: indexColumns,
      unique: index.unique === true,
    });
  }
  for (const index of indexes) {
    if (indexNames.has(index.name)) {
      throw new TypeError(`duplicate index name ${JSON.stringify(index.name)}`);
    }
    indexNames.add(index.name);
  }
  const descriptor: TableDescriptor = {
    format_version: 1,
    table_id: id,
    columns: descriptorColumns,
    primary_key: primaryKey,
    indexes: indexes.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ),
  };
  const registered = tableRegistry.get(id);
  if (
    registered !== undefined &&
    JSON.stringify(registered) !== JSON.stringify(descriptor)
  ) {
    throw new TypeError(`conflicting table definition ${JSON.stringify(id)}`);
  }
  tableRegistry.set(id, descriptor);
  const local = () => getDatabase() as unknown as RuntimeDatabase;
  const value: Record<PropertyKey, unknown> = {};
  Object.defineProperty(value, "table", { value: id, enumerable: true });
  Object.defineProperty(value, tableDescriptorSymbol, {
    value: descriptor,
    enumerable: false,
  });
  for (const name of names) {
    Object.defineProperty(value, name, {
      value: `${id}.${name}`,
      enumerable: true,
    });
  }
  Object.defineProperties(value, {
    select: {
      value: (selection: readonly string[]) =>
        local().selectFrom(id).select(selection),
    },
    selectAll: { value: () => local().selectFrom(id).selectAll() },
    insert: {
      value: (
        values:
          | Readonly<Record<string, unknown>>
          | readonly Readonly<Record<string, unknown>>[],
      ) => local().insertInto(id).values(values),
    },
    update: {
      value: (values: Readonly<Record<string, unknown>>) =>
        local().updateTable(id).set(values),
    },
    delete: { value: () => local().deleteFrom(id) },
  });
  return Object.freeze(value) as TableObject<ID, Columns>;
}

function portableTableId(id: string): boolean {
  if (new TextEncoder().encode(id).length > 63) return false;
  const parts = id.split("__");
  if (
    parts.length === 3 &&
    parts.every((part) => portableTableComponent.test(part))
  ) return true;
  return id.length === 63 && id[56] === "_" &&
    /^[a-z0-9][a-z0-9_]{55}_[a-f0-9]{6}$/.test(id);
}

function shortIdentifier(value: string): string {
  if (new TextEncoder().encode(value).length <= 63) return value;
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${value.slice(0, 54)}_${hash.toString(16).padStart(8, "0")}`;
}

export function registeredTable(id: string): TableDescriptor | undefined {
  return tableRegistry.get(id);
}

export function descriptorOf(value: unknown): TableDescriptor {
  if (value === null || typeof value !== "object") {
    throw new TypeError("table module default export is not an 80|20 table");
  }
  const descriptor = (value as Record<PropertyKey, unknown>)[
    tableDescriptorSymbol
  ];
  if (
    descriptor === null || typeof descriptor !== "object" ||
    (descriptor as TableDescriptor).format_version !== 1
  ) {
    throw new TypeError("table module default export is not an 80|20 table");
  }
  return structuredClone(descriptor as TableDescriptor);
}

function newColumn<Select>(
  logicalType: LogicalType,
  options: Partial<ColumnState> = {},
): ColumnDefinition<Select> {
  return new ColumnDefinition({
    logicalType,
    nullable: false,
    generated: false,
    primaryKey: false,
    unique: false,
    ...options,
  });
}

export const t = Object.freeze({
  from: columnFromSchema,
  text: () => newColumn<string>("text"),
  boolean: () => newColumn<boolean>("boolean"),
  integer: () => newColumn<number>("integer"),
  float: () => newColumn<number>("float"),
  decimal: (precision: number, scale: number) => {
    assertDecimalDefinition(precision, scale);
    return newColumn<string>("decimal", { precision, scale });
  },
  datetime: () => newColumn<Date>("datetime"),
  bytes: () => newColumn<Uint8Array>("bytes"),
  json: <Value extends JSONValue>() => newColumn<Value>("json"),
  enum: <const Values extends readonly [string, ...string[]]>(
    values: Values,
  ) => {
    return newColumn<Values[number]>("enum", {
      enumValues: normalizedEnumValues(values),
    });
  },
});

/** SQL storage for an ordinary Zod field; keys and defaults stay table-local. */
function columnFromSchema<Schema extends z.ZodType>(
  schema: Schema,
  storage?: ColumnDefinition<z.output<Schema>>,
): ColumnDefinition<z.output<Schema>> {
  const chain = fieldSchemas(schema);
  if (
    chain.some((item) =>
      item instanceof z.ZodOptional || item instanceof z.ZodDefault ||
      item instanceof z.ZodCatch
    )
  ) {
    throw new TypeError(
      "SQL fields cannot be optional or have Zod defaults; use nullable() or a column default() explicitly",
    );
  }
  const declared = fieldMetadata(schema)?.storage;
  const primitive = chain.at(-1)!;
  let column: AnyColumn;
  if (declared !== undefined) {
    column = columnFromStorage(declared);
    if (storage !== undefined) {
      const expected = column.descriptor("field");
      const actual = storage.descriptor("field");
      if (
        expected.logical_type !== actual.logical_type ||
        expected.precision !== actual.precision ||
        expected.scale !== actual.scale ||
        JSON.stringify(expected.enum_values) !==
          JSON.stringify(actual.enum_values)
      ) {
        throw new TypeError(
          "Column storage must match the field's declared storage type",
        );
      }
      column = storage;
    }
  } else if (storage !== undefined) column = storage;
  else if (primitive.type === "string") column = t.text();
  else if (primitive instanceof z.ZodBoolean) column = t.boolean();
  else if (
    primitive instanceof z.ZodNumber || primitive instanceof z.ZodNumberFormat
  ) {
    column = primitive.isInt ? t.integer() : t.float();
  } else if (primitive instanceof z.ZodDate) column = t.datetime();
  else if (
    primitive instanceof z.ZodEnum &&
    primitive.options.every((value) => typeof value === "string")
  ) {
    column = t.enum(primitive.options as [string, ...string[]]);
  } else {
    throw new TypeError(
      "This Zod field needs explicit SQL storage; declare field(schema, { storage: ... }) at its definition",
    );
  }
  return (chain.some((item) => item instanceof z.ZodNullable)
    ? column.nullable()
    : column) as ColumnDefinition<z.output<Schema>>;
}

function columnFromStorage(storage: FieldStorage): AnyColumn {
  switch (storage.type) {
    case "decimal":
      return t.decimal(storage.precision, storage.scale);
    case "enum":
      return t.enum(storage.values);
    case "json":
      return t.json();
    default:
      return t[storage.type]();
  }
}

function literalDefault(state: ColumnState, value: unknown): DefaultDescriptor {
  switch (state.logicalType) {
    case "text":
      if (typeof value !== "string") throw invalidDefault(state.logicalType);
      return { kind: "literal", value };
    case "enum":
      if (
        typeof value !== "string" || !state.enumValues?.includes(value)
      ) throw invalidDefault(state.logicalType);
      return { kind: "literal", value };
    case "boolean":
      if (typeof value !== "boolean") throw invalidDefault(state.logicalType);
      return { kind: "literal", value };
    case "integer":
      assertSafeInteger(value);
      return { kind: "literal", value };
    case "float":
      assertFiniteFloat(value);
      return { kind: "literal", value };
    case "decimal":
      assertDecimal(value, state.precision!, state.scale!);
      return { kind: "literal", value };
    case "datetime":
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw invalidDefault(state.logicalType);
      }
      return { kind: "literal", value: value.toISOString() };
    case "bytes":
      if (!(value instanceof Uint8Array)) {
        throw invalidDefault(state.logicalType);
      }
      return { kind: "literal", value: bytesToBase64(value) };
    case "json": {
      try {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) throw new TypeError();
        return {
          kind: "literal",
          value: canonicalJSON(JSON.parse(encoded) as JSONValue),
        };
      } catch {
        throw invalidDefault(state.logicalType);
      }
    }
  }
}

function canonicalJSON(value: JSONValue): JSONValue {
  if (Array.isArray(value)) return value.map(canonicalJSON);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJSON(value[key]!)]),
    );
  }
  return value;
}

function invalidDefault(type: LogicalType): TypeError {
  return new TypeError(`invalid ${type} default`);
}
