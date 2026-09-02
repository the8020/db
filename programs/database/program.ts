import { kernel } from "@the8020/kernel";
import {
  BACK_EVENT,
  callScreen,
  field,
  showNotification,
  z,
} from "@packages/the8020/uui/mod.ts";
import definitionsLayout from "./layouts/definitions.json" with {
  type: "json",
};
import detailLayout from "./layouts/detail.json" with { type: "json" };
import listLayout from "./layouts/list.json" with { type: "json" };

interface TableSummary {
  table_id: string;
  source_package: string;
  source_commit: string;
  state: string;
  synchronization_state: string;
  descriptor_hash: string;
  synchronized_at?: string;
  active_columns: number;
  retired_columns: number;
  error?: string;
  definition_state?: string;
  current_source_commit?: string;
}

const Screen = z.object({
  tables: z.array(z.object({
    navigation: z.string(),
    id: field(z.string(), { label: "Table", readOnly: true, length: "long" }),
    package: field(z.string(), {
      label: "Package",
      readOnly: true,
      length: "medium",
    }),
    commit: field(z.string(), {
      label: "Source commit",
      readOnly: true,
      length: "medium",
    }),
    state: field(z.string(), {
      label: "State",
      readOnly: true,
      length: "short",
    }),
    descriptor: field(z.string(), {
      label: "Descriptor",
      readOnly: true,
      length: "medium",
    }),
    synchronized: field(z.string(), {
      label: "Synchronized",
      readOnly: true,
      length: "medium",
    }),
    columns: field(z.string(), {
      label: "Active / retired",
      readOnly: true,
      length: "short",
    }),
    alert: field(z.string(), {
      label: "Alert",
      readOnly: true,
      length: "long",
    }),
  })),
});

export default async function databaseTables(): Promise<void> {
  while (true) {
    const result = await kernel.database.tables.list() as TableSummary[];
    const event = await callScreen({
      id: "database-tables",
      title: "Database tables",
      schema: Screen,
      model: {
        tables: result.map((table) => ({
          navigation: table.table_id,
          id: table.table_id,
          package: table.source_package,
          commit: table.source_commit,
          state: `${table.state} / ${table.synchronization_state}`,
          descriptor: table.descriptor_hash,
          synchronized: table.synchronized_at ?? "",
          columns: `${table.active_columns} / ${table.retired_columns}`,
          alert: tableAlert(table),
        })),
      },
      layout: listLayout,
      header: {
        actions: [
          { id: "sync-all", label: "Synchronize all", kind: "primary" },
          { id: "definitions", label: "Definition changes" },
          { id: "refresh", label: "[[icon=refresh]] Refresh" },
        ],
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "select" && typeof event.value === "string") {
      await tableDetail(event.value);
    }
    if (event.action === "definitions") await definitionList();
    if (event.action === "sync-all") {
      try {
        await kernel.database.tables.synchronizeAll();
        showNotification("Database tables synchronized", "success");
      } catch (error) {
        showNotification(
          error instanceof Error ? error.message : "Synchronization failed",
          "error",
        );
      }
    }
  }
}

export function tableAlert(table: TableSummary): string {
  const alerts = [table.error ?? ""];
  if (table.definition_state === "missing") {
    alerts.push("definition file missing");
  } else if (table.definition_state === "commit_mismatch") {
    alerts.push("source commit mismatch");
  } else if (table.definition_state === "error") {
    alerts.push("definition invalid or unavailable");
  }
  if (table.retired_columns > 0) {
    alerts.push(`${table.retired_columns} retired columns`);
  }
  return [...new Set(alerts.filter(Boolean))].join("; ");
}

interface TableDetail extends Record<string, unknown> {
  table_id: string;
  source_package: string;
  source_commit: string;
  state: string;
  synchronization_state: string;
  descriptor_hash: string;
  synchronized_at?: string;
  descriptor: Record<string, unknown>;
  current_descriptor?: Record<string, unknown>;
  current_descriptor_hash?: string;
  definition_state?: string;
  columns: Array<{ column_name: string; state: string }>;
  physical_columns: unknown[];
  physical_indexes: unknown[];
  physical_checks: string[];
  differences: string[];
}

const DetailScreen = z.object({
  tableId: field(z.string(), { label: "Table", readOnly: true }),
  state: field(z.string(), { label: "State", readOnly: true }),
  package: field(z.string(), { label: "Package", readOnly: true }),
  commit: field(z.string(), { label: "Package commit", readOnly: true }),
  descriptorHash: field(z.string(), {
    label: "Descriptor hash",
    readOnly: true,
  }),
  synchronizedAt: field(z.string(), {
    label: "Last synchronized",
    readOnly: true,
  }),
  differences: field(z.string(), {
    label: "Detected differences",
    control: "textarea",
    readOnly: true,
  }),
  logical: field(z.string(), {
    label: "Deployed logical descriptor",
    control: "textarea",
    readOnly: true,
  }),
  current: field(z.string(), {
    label: "Activated source descriptor",
    control: "textarea",
    readOnly: true,
  }),
  physical: field(z.string(), {
    label: "Current physical columns",
    control: "textarea",
    readOnly: true,
  }),
  catalog: field(z.string(), {
    label: "Catalog columns",
    control: "textarea",
    readOnly: true,
  }),
  confirmDestructive: field(z.boolean(), {
    label: "Confirm permanent deletion",
    description:
      "Required before trimming. Retired table or column data cannot be recovered.",
    control: "checkbox",
  }),
});

async function tableDetail(tableId: string): Promise<void> {
  let confirmDestructive = false;
  while (true) {
    const detail = await kernel.database.tables.inspect(tableId) as TableDetail;
    const retired = detail.columns.filter((column) =>
      column.state === "retired"
    )
      .map((column) => column.column_name);
    const model: z.infer<typeof DetailScreen> = {
      tableId,
      state: `${detail.state} / ${detail.synchronization_state}`,
      package: detail.source_package,
      commit: detail.source_commit,
      descriptorHash: detail.descriptor_hash,
      synchronizedAt: detail.synchronized_at ?? "",
      differences: detail.differences.join("\n"),
      logical: JSON.stringify(detail.descriptor, null, 2),
      current: detail.current_descriptor === undefined
        ? `(${detail.definition_state ?? "unavailable"})`
        : JSON.stringify(detail.current_descriptor, null, 2),
      physical: JSON.stringify(
        {
          columns: detail.physical_columns,
          indexes: detail.physical_indexes,
          checks: detail.physical_checks,
        },
        null,
        2,
      ),
      catalog: JSON.stringify(detail.columns, null, 2),
      confirmDestructive,
    };
    const event = await callScreen({
      id: "database-table-detail",
      title: tableId,
      schema: DetailScreen,
      model,
      layout: detailLayout,
      header: {
        actions: [
          ...(detail.source_package
            ? [{ id: "sync", label: "Synchronize", kind: "primary" as const }]
            : []),
          { id: "refresh", label: "Refresh" },
          ...(retired.length > 0
            ? [{
              id: "trim-columns",
              label: "Trim retired columns",
              kind: "danger" as const,
            }]
            : []),
          ...(detail.state === "retired"
            ? [{
              id: "trim-table",
              label: "Trim table",
              kind: "danger" as const,
            }]
            : []),
        ],
      },
    });
    confirmDestructive = model.confirmDestructive;
    if (event.action === BACK_EVENT) return;
    try {
      if (event.action === "sync") {
        await kernel.database.tables.synchronize(tableId);
        showNotification("Table synchronized", "success");
      }
      if (event.action === "trim-columns") {
        requireDestructiveConfirmation(confirmDestructive);
        await kernel.database.tables.trim({
          tableId,
          columns: retired,
          confirm: true,
        });
        confirmDestructive = false;
        showNotification("Retired columns permanently removed", "success");
      }
      if (event.action === "trim-table") {
        requireDestructiveConfirmation(confirmDestructive);
        await kernel.database.tables.trim({
          tableId,
          dropTable: true,
          confirm: true,
        });
        showNotification("Retired table permanently removed", "success");
        return;
      }
    } catch (error) {
      showNotification(
        error instanceof Error ? error.message : "Database operation failed",
        "error",
      );
    }
  }
}

export function requireDestructiveConfirmation(confirmed: boolean): void {
  if (!confirmed) {
    throw new Error("Confirm permanent deletion before trimming database data");
  }
}

const DefinitionsScreen = z.object({
  definitions: z.array(z.object({
    navigation: z.string(),
    id: field(z.string(), { label: "Definition", readOnly: true }),
    package: field(z.string(), { label: "Package", readOnly: true }),
    state: field(z.string(), { label: "State", readOnly: true }),
    commit: field(z.string(), { label: "Commit", readOnly: true }),
    error: field(z.string(), { label: "Error", readOnly: true }),
  })),
});

async function definitionList(): Promise<void> {
  while (true) {
    const definitions = await kernel.database.tables.definitions();
    const event = await callScreen({
      id: "database-table-definitions",
      title: "Definition changes",
      schema: DefinitionsScreen,
      model: {
        definitions: definitions.map((definition) => ({
          navigation: definition.table_id,
          id: definition.table_id,
          package: definition.source_package,
          state: definition.synchronization_state,
          commit: definition.source_commit,
          error: definition.error ?? "",
        })),
      },
      layout: definitionsLayout,
      header: { actions: [{ id: "refresh", label: "Refresh" }] },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "select" && typeof event.value === "string") {
      try {
        const selected = definitions.find((definition) =>
          definition.table_id === event.value
        );
        await kernel.database.tables.synchronize(
          event.value,
          selected?.source_package,
        );
        showNotification("Table synchronized", "success");
      } catch (error) {
        showNotification(
          error instanceof Error ? error.message : "Synchronization failed",
          "error",
        );
      }
    }
  }
}
