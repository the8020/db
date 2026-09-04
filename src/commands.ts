import {
  AdminCommandError,
  type DatabaseValue,
  kernel,
  parseCommandArguments,
  requiredCommandArgument,
} from "@the8020/kernel";

export function check() {
  return kernel.database.check();
}

export function sql(...args: string[]) {
  const parsed = parseCommandArguments(args, {
    values: ["parameters"],
    booleans: ["execute"],
  });
  const statement = requiredCommandArgument(
    parsed.positionals,
    0,
    "SQL statement",
  );
  let parameters: DatabaseValue[] = [];
  if (typeof parsed.options.parameters === "string") {
    const value: unknown = JSON.parse(parsed.options.parameters);
    if (!Array.isArray(value)) {
      throw new AdminCommandError({
        code: "invalid_arguments",
        message: "--parameters must be a JSON array",
      });
    }
    parameters = value as DatabaseValue[];
  }
  return kernel.database.execute(statement, parameters, {
    returnRows: parsed.options.execute !== true,
  });
}

export function tableList() {
  return kernel.database.tables.list().then((tables) => ({ tables }));
}

export function definitions() {
  return kernel.database.tables.definitions().then((definitions) => ({
    definitions,
  }));
}

export function inspect(...args: string[]) {
  return kernel.database.tables.inspect(
    requiredCommandArgument(args, 0, "table ID"),
  )
    .then((table) => ({ table }));
}

export function compare(...args: string[]) {
  return kernel.database.tables.compare(
    requiredCommandArgument(args, 0, "table ID"),
  )
    .then((table) => ({ table }));
}

export function synchronize(...args: string[]) {
  const parsed = parseCommandArguments(args, { values: ["package"] });
  return kernel.database.tables.synchronize(
    requiredCommandArgument(parsed.positionals, 0, "table ID"),
    typeof parsed.options.package === "string"
      ? parsed.options.package
      : undefined,
  ).then((table) => ({ table }));
}

export function synchronizeAll() {
  return kernel.database.tables.synchronizeAll().then((tables) => ({ tables }));
}

export function trim(...args: string[]) {
  const parsed = parseCommandArguments(args, {
    values: ["columns"],
    booleans: ["drop-table", "confirm"],
  });
  if (parsed.options.confirm !== true) {
    throw new AdminCommandError({
      code: "invalid_arguments",
      message: "--confirm is required",
    });
  }
  const tableId = requiredCommandArgument(parsed.positionals, 0, "table ID");
  const columns = typeof parsed.options.columns === "string"
    ? parsed.options.columns.split(",").filter(Boolean)
    : undefined;
  return kernel.database.tables.trim({
    tableId,
    columns,
    dropTable: parsed.options["drop-table"] === true,
    confirm: true,
  }).then(() => ({
    table_id: tableId,
    dropped_table: parsed.options["drop-table"] === true,
    dropped_columns: columns ?? [],
  }));
}
