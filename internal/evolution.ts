/** Schema policy shared by preview and execution. */
import type { ColumnDescriptor, TableDescriptor } from "../src/schema.ts";

export function semantic(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
          .filter(([, value]) => value !== undefined)
          .map((
            [key, value],
          ) => [
            key,
            key === "enum_values" && Array.isArray(value)
              ? [...value].sort()
              : normalize(value),
          ]),
      );
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

export function storage(c: ColumnDescriptor): string {
  const { reference: _reference, unique: _unique, ...value } = c;
  return semantic(value);
}

/** Membership-only text/enum changes can be validated without a callback. */
export function membershipChange(
  a: ColumnDescriptor,
  b: ColumnDescriptor,
): boolean {
  const { logical_type: at, enum_values: _av, ...av } = a;
  const { logical_type: bt, enum_values: _bv, ...bv } = b;
  return [at, bt].every((t) => t === "text" || t === "enum") &&
    semantic({ ...av, reference: undefined, unique: undefined }) ===
      semantic({ ...bv, reference: undefined, unique: undefined });
}

export function migrationReasons(
  previous: TableDescriptor,
  next: TableDescriptor,
  backend: string,
): string[] {
  const reasons: string[] = [];
  if (semantic(previous.primary_key) !== semantic(next.primary_key)) {
    reasons.push("changing primary key");
  }
  for (const c of next.columns) {
    const old = previous.columns.find((p) => p.name === c.name);
    if (old) {
      const relaxation = membershipChange(old, c) &&
        (c.logical_type === "text" ||
          old.logical_type === "enum" &&
            old.enum_values!.every((v) => c.enum_values!.includes(v)));
      const defaultOrNullRelaxation =
        storage({ ...old, default: undefined, nullable: true }) ===
          storage({ ...c, default: undefined, nullable: true }) &&
        (!old.nullable || c.nullable);
      if (
        storage(old) !== storage(c) && !relaxation && !defaultOrNullRelaxation
      ) {
        reasons.push(`changing column ${c.name}`);
      }
    } else if (
      c.primary_key || c.generated ||
      (!c.nullable && c.default?.kind !== "literal") ||
      c.default?.kind === "now"
    ) {
      reasons.push(`adding column ${c.name}`);
    }
  }
  for (const c of previous.columns) {
    if (
      backend === "sqlite" && !next.columns.some((n) => n.name === c.name) &&
      !c.nullable && !c.default
    ) reasons.push(`retiring required column ${c.name}`);
  }
  const uniqueKeys = [
    previous.primary_key,
    ...(previous.indexes ?? []).filter((i) => i.unique).map((i) => i.columns),
  ].filter((columns) => columns.length);
  for (const index of next.indexes ?? []) {
    if (
      index.unique &&
      !uniqueKeys.some((columns) =>
        columns.every((c) => index.columns.includes(c))
      )
    ) reasons.push(`changing index ${index.name}`);
  }
  return reasons;
}
