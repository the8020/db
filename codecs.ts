/** Descriptor-aware codecs for consumers of the raw kernel database API. */
export {
  bytesToBase64,
  type DatabaseValue,
  decodeDatabaseColumnValue,
  decodeDatabaseValue,
  type TaggedDatabaseValue,
} from "./src/values.ts";
export type {
  ColumnDescriptor,
  LogicalType,
  TableDescriptor,
} from "./src/descriptor.ts";
