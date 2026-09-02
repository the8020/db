import { descriptorOf, type TableDescriptor } from "../src/descriptor.ts";

export interface EvaluationRequest {
  package_root: string;
  tables: Array<{
    module: string;
    expected_table_id: string;
    package_id: string;
    package_commit: string;
    dependencies?: string[];
  }>;
}

export interface EvaluatedTable {
  descriptor: TableDescriptor;
  descriptor_json: string;
  descriptor_hash: string;
  source_module: string;
  source_package: string;
  source_commit: string;
  dependencies: string[];
}

const maximumBatch = 256;

export default async function evaluate(
  input: EvaluationRequest,
): Promise<{ tables: EvaluatedTable[] }> {
  if (
    input === null || typeof input !== "object" ||
    typeof input.package_root !== "string" ||
    !input.package_root.startsWith("/") || !Array.isArray(input.tables) ||
    input.tables.length === 0 || input.tables.length > maximumBatch
  ) {
    throw new TypeError(`table evaluator requires 1..${maximumBatch} modules`);
  }
  const prefix = `${input.package_root.replace(/\/+$/, "")}/`;
  const tables: EvaluatedTable[] = [];
  for (const item of input.tables) {
    if (
      typeof item.module !== "string" || !item.module.startsWith(prefix) ||
      !item.module.endsWith(".ts") || item.module.includes("/../") ||
      typeof item.expected_table_id !== "string" ||
      typeof item.package_id !== "string" ||
      typeof item.package_commit !== "string"
    ) throw new TypeError("invalid table evaluation item");
    const module = await import(pathToFileURL(item.module).href) as {
      default?: unknown;
    };
    const descriptor = descriptorOf(module.default);
    if (descriptor.table_id !== item.expected_table_id) {
      throw new TypeError(
        `${item.module} exports ${descriptor.table_id}; expected ${item.expected_table_id}`,
      );
    }
    const descriptorJson = JSON.stringify(descriptor);
    tables.push({
      descriptor,
      descriptor_json: descriptorJson,
      descriptor_hash: await sha256(descriptorJson),
      source_module: item.module,
      source_package: item.package_id,
      source_commit: item.package_commit,
      dependencies: [...new Set([item.module, ...(item.dependencies ?? [])])]
        .sort(),
    });
  }
  return { tables };
}

function pathToFileURL(path: string): URL {
  return new URL(`file://${path.split("/").map(encodeURIComponent).join("/")}`);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
