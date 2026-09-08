import { type SelectQueryBuilder, sql } from "kysely";
import {
  fieldSchemas,
  type ValueHelpPage,
  type ValueHelpRequest,
  z,
} from "./fields.ts";

/** SQL-backed lookup for selected text/boolean fields; never loads the full table. */
export async function lookupPage<DB, TB extends keyof DB, Row>(
  schema: z.ZodObject,
  source: SelectQueryBuilder<DB, TB, Row>,
  { query, offset, limit }: ValueHelpRequest,
): Promise<ValueHelpPage> {
  const columns = Object.entries(schema.shape).map(([key, field]) => {
    const type = fieldSchemas(field as z.ZodType).at(-1)!.type;
    if (!["string", "enum", "boolean"].includes(type)) {
      throw new TypeError("SQL lookup columns must be text or boolean");
    }
    return { key, boolean: type === "boolean" };
  });
  if (
    !columns.length || !Number.isSafeInteger(offset) || offset < 0 ||
    !Number.isSafeInteger(limit) || limit < 1
  ) {
    throw new TypeError("invalid lookup schema or range");
  }
  const keys = new Set(columns.map((column) => column.key));
  if (
    Object.keys(query.filters).some((key) => !keys.has(key)) ||
    (query.sort && !keys.has(query.sort.column))
  ) {
    throw new TypeError("unknown lookup column");
  }
  const text = (column: typeof columns[number]) =>
    column.boolean
      ? sql<string>`case when ${sql.ref(column.key)} is true then 'true' when ${
        sql.ref(column.key)
      } is false then 'false' else '' end`
      : sql<string>`lower(coalesce(${sql.ref(column.key)}, ''))`;
  const contains = (column: typeof columns[number], value: string) =>
    sql<boolean>`${text(column)} like ${`%${
      value.toLocaleLowerCase("en").replace(/[\\%_]/g, "\\$&")
    }%`} escape '\\'`;
  let filtered = source;
  if (query.search.trim()) {
    filtered = filtered.where(
      sql<boolean>`(${
        sql.join(
          columns.map((column) => contains(column, query.search.trim())),
          sql` or `,
        )
      })`,
    );
  }
  for (const column of columns) {
    const value = query.filters[column.key]?.trim();
    if (!value) continue;
    const ref = sql.ref(column.key);
    if (value === "is:null") {
      filtered = filtered.where(sql<boolean>`${ref} is null`);
    } else if (value === "is:empty" || value === "is:not-empty") {
      const empty = column.boolean
        ? sql<boolean>`${ref} is null`
        : sql<boolean>`(${ref} is null or ${ref} = '')`;
      filtered = filtered.where(
        value === "is:empty" ? empty : sql<boolean>`not (${empty})`,
      );
    } else if (column.boolean) {
      const normalized = value.toLowerCase();
      const boolean = ["true", "yes", "1"].includes(normalized)
        ? true
        : ["false", "no", "0"].includes(normalized)
        ? false
        : undefined;
      filtered = filtered.where(
        boolean === undefined
          ? sql<boolean>`false`
          : sql<boolean>`${ref} = ${sql.lit(boolean)}`,
      );
    } else filtered = filtered.where(contains(column, value));
  }
  const sort = query.sort ??
    { column: columns[0]!.key, direction: "asc" as const };
  const column = columns.find((column) => column.key === sort.column)!;
  let ordered = filtered.clearOrderBy().orderBy(
    column.boolean
      ? sql<number>`case when ${sql.ref(column.key)} is true then 1 when ${
        sql.ref(column.key)
      } is false then 0 else -1 end`
      : text(column),
    sort.direction,
  );
  if (sort.column !== columns[0]!.key) {
    ordered = ordered.orderBy(sql.ref(columns[0]!.key));
  }
  const [rows, count] = await Promise.all([
    ordered.offset(offset).limit(limit).execute(),
    filtered.clearSelect().clearOrderBy().select(
      sql<number>`count(*)`.as("total"),
    ).$castTo<{ total: number }>().executeTakeFirstOrThrow(),
  ]);
  const totalItems = Number(count.total);
  return {
    schema,
    rows: schema.array().parse(rows),
    totalItems,
    more: offset + rows.length < totalItems,
  };
}
