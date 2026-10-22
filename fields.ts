// @deno-types="./vendor/zod.ts"
import { z } from "./vendor/zod.js";
import type { JSONValue, LogicalType } from "./src/schema.ts";
import { type FieldMultiple, validMultiple } from "./multiple.ts";
import {
  assertDecimal,
  assertDecimalDefinition,
  normalizedEnumValues,
} from "./src/values.ts";

export { z };
export {
  escapeMultiple,
  type FieldMultiple,
  joinMultiple,
  multipleLiteral,
  splitMultiple,
} from "./multiple.ts";

interface StorageValues {
  text: string;
  boolean: boolean;
  integer: number;
  float: number;
  decimal: string;
  datetime: Date;
  bytes: Uint8Array;
  json: JSONValue;
  enum: string;
}

type Storage = {
  [Kind in LogicalType]:
    & { type: Kind }
    & (Kind extends "decimal" ? { precision: number; scale: number }
      : Kind extends "enum" ? { values: readonly [string, ...string[]] }
      : object);
}[LogicalType];

/** A value representation, independent of table keys, defaults, and indexes. */
export type FieldStorage<Value = unknown> = unknown extends Value ? Storage : {
  [Kind in LogicalType]: Exclude<Value, null | undefined> extends
    StorageValues[Kind] ? Extract<Storage, { type: Kind }> : never;
}[LogicalType];

// Storage belongs to the schema definition, so Zod refinements retain it.
// Presentation metadata intentionally follows Zod's ordinary registry semantics.
const storageSymbol = Symbol.for("the8020.db.field-storage");

export interface ListQuery {
  search: string;
  filters: Record<string, string>;
  sort: { column: string; direction: "asc" | "desc" } | null;
}

export interface ValueHelpRequest {
  query: ListQuery;
  offset: number;
  limit: number;
}

export interface ValueHelpItem<Value> {
  value: Value;
  label: string;
  description?: string;
}

export interface ValueHelpPage {
  /** Ordinary fields in display order. The first field supplies the selected value. */
  schema: z.ZodObject;
  rows: Record<string, unknown>[];
  more: boolean;
  totalItems?: number;
  totalSourceItems?: number;
}

/** How a field holds several values, if it does. */
export type MultipleValues =
  | { kind: "array"; element: z.ZodType }
  | { kind: "text"; separator: string; escape: string };

/** Meaning shared by forms, lists, and other consumers of a Zod field. */
export interface FieldMetadata<Value = unknown> {
  storage?: FieldStorage<Value>;
  label?: string;
  description?: string;
  multiple?: FieldMultiple;
  valueHelp?(
    request: ValueHelpRequest,
  ): ValueHelpPage | Promise<ValueHelpPage>;
  open?(value: Value): void | Promise<void>;
}

// Callback schemas are opaque metadata, not Zod input/output placeholders.
const metadata = z.registry<
  Omit<FieldMetadata, "valueHelp"> & { valueHelp?: unknown }
>();

/** Return an independent schema; customizing a use never changes its source. */
export function field<T extends z.ZodType>(
  schema: T,
  options: FieldMetadata<z.output<T>>,
): T {
  const inherited = fieldMetadata(schema);
  if (options.multiple !== undefined) validMultiple(options.multiple);
  const storage = options.storage ?? inherited?.storage;
  if (
    inherited?.storage !== undefined && options.storage !== undefined &&
    JSON.stringify(inherited.storage) !==
      JSON.stringify(normalizeStorage(options.storage))
  ) {
    throw new TypeError(
      "A field's storage type cannot be changed; define a new field",
    );
  }
  const definition = storage === undefined ? schema.def : {
    ...schema.def,
    [storageSymbol]: normalizeStorage(storage),
  };
  const result = schema.clone(definition);
  const { storage: _storage, ...meaning } = { ...inherited, ...options };
  metadata.add(
    result,
    meaning as FieldMetadata,
  );
  return result;
}

/** Outer field metadata overrides the metadata of nullable/optional wrappers. */
export function fieldMetadata<T extends z.ZodType>(
  schema: T,
): FieldMetadata<z.output<T>> | undefined {
  let result: FieldMetadata<z.output<T>> | undefined;
  for (const current of fieldSchemas(schema).reverse()) {
    const standard = current.meta();
    const own = metadata.get(current) as FieldMetadata<z.output<T>> | undefined;
    if (own || standard?.title || standard?.description) {
      result = {
        ...result,
        ...(standard?.title === undefined ? {} : { label: standard.title }),
        ...(standard?.description === undefined
          ? {}
          : { description: standard.description }),
        ...own,
      };
    }
    const storage =
      (current.def as { [storageSymbol]?: Storage })[storageSymbol];
    if (storage !== undefined) {
      result = { ...result, storage } as FieldMetadata<z.output<T>>;
    }
  }
  return result;
}

/**
 * An array of scalar values, or a text field declaring `multiple`. Other
 * fields hold one value.
 */
export function multipleValues(schema: z.ZodType): MultipleValues | undefined {
  const inner = fieldSchemas(schema).at(-1)!;
  if (inner instanceof z.ZodArray) {
    const element = inner.element as z.ZodType;
    const value = fieldSchemas(element).at(-1)!;
    return value instanceof z.ZodString || value instanceof z.ZodNumber ||
        value instanceof z.ZodEnum
      ? { kind: "array", element }
      : undefined;
  }
  const declared = fieldMetadata(schema)?.multiple;
  if (declared === undefined || !(inner instanceof z.ZodString)) {
    return undefined;
  }
  return {
    kind: "text",
    separator: declared.separator,
    escape: declared.escape ?? "",
  };
}

/** Search and page known choices without restricting the field's valid values. */
export function choiceHelp<Value extends string | number | boolean>(
  schema: z.ZodType<Value>,
  items: readonly (Value | ValueHelpItem<Value>)[],
): NonNullable<FieldMetadata<Value>["valueHelp"]> {
  const rows = items.map((item) =>
    typeof item === "object"
      ? { value: item.value, label: item.label }
      : { value: item, label: String(item) }
  );
  return async (request) => {
    const { queryValueHelp } = await import("/p/the8020/uui/lists.ts");
    return queryValueHelp(
      z.object({
        value: field(schema, {
          label: fieldMetadata(schema)?.label ?? "Value",
        }),
        label: field(z.string(), {
          label: "Name",
          description: "The name or meaning of this choice.",
        }),
      }),
      rows,
      request,
    );
  };
}

/** Exact fixed-scale decimal strings, using the database codec's validation. */
export function decimal(precision: number, scale: number): z.ZodString {
  assertDecimalDefinition(precision, scale);
  return field(
    z.string().refine((value) => {
      try {
        assertDecimal(value, precision, scale);
        return true;
      } catch {
        return false;
      }
    }, {
      error:
        `Enter a decimal with exactly ${scale} decimal places and at most ${precision} total digits.`,
    }),
    { storage: { type: "decimal", precision, scale } },
  );
}

/** A monetary amount; currency is a separate field when the application needs it. */
export function money(precision = 18, scale = 2): z.ZodString {
  return field(decimal(precision, scale), { label: "Amount" });
}

function normalizeStorage(storage: Storage): Readonly<Storage> {
  switch (storage.type) {
    case "decimal":
      assertDecimalDefinition(storage.precision, storage.scale);
      return Object.freeze({
        type: "decimal",
        precision: storage.precision,
        scale: storage.scale,
      });
    case "enum": {
      return Object.freeze({
        type: "enum",
        values: normalizedEnumValues(storage.values),
      });
    }
    case "text":
    case "boolean":
    case "integer":
    case "float":
    case "datetime":
    case "bytes":
    case "json":
      return Object.freeze({ type: storage.type });
    default:
      throw new TypeError("unknown field storage type");
  }
}

/** Public Zod wrappers that preserve the underlying field's meaning. */
export function fieldSchemas(schema: z.ZodType): z.ZodType[] {
  const result = [schema];
  let current = schema;
  while (
    current instanceof z.ZodOptional || current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault || current instanceof z.ZodCatch ||
    current instanceof z.ZodReadonly
  ) {
    current = current.unwrap() as z.ZodType;
    result.push(current);
  }
  return result;
}
