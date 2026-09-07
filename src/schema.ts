/** Plain database schema contracts, independent of Zod, Kysely, and execution. */
export type LogicalType =
  | "text"
  | "boolean"
  | "integer"
  | "float"
  | "decimal"
  | "datetime"
  | "bytes"
  | "json"
  | "enum";

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

export interface DefaultDescriptor {
  kind: "literal" | "now";
  value?: JSONValue;
}

export interface ReferenceDescriptor {
  table: string;
  column: string;
}

export interface ColumnDescriptor {
  name: string;
  logical_type: LogicalType;
  precision?: number;
  scale?: number;
  enum_values?: string[];
  nullable: boolean;
  default?: DefaultDescriptor;
  generated: boolean;
  primary_key: boolean;
  unique: boolean;
  reference?: ReferenceDescriptor;
}

export interface IndexDescriptor {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableDescriptor {
  format_version: 1;
  table_id: string;
  columns: ColumnDescriptor[];
  primary_key: string[];
  indexes: IndexDescriptor[];
}
