import type { LogicalType } from "./descriptor.ts";

export interface LogicalValue {
  readonly value: unknown;
  readonly logicalType: LogicalType;
  readonly precision?: number;
  readonly scale?: number;
}

const logicalValueSymbol = Symbol("the8020.db.logical-value");

export function logicalValue(
  value: unknown,
  logicalType: LogicalType,
  precision?: number,
  scale?: number,
): unknown {
  if (isLogicalValue(value)) return value;
  return Object.freeze({
    [logicalValueSymbol]: true,
    value,
    logicalType,
    ...(precision === undefined ? {} : { precision }),
    ...(scale === undefined ? {} : { scale }),
  });
}

function isLogicalValue(value: unknown): value is LogicalValue {
  return value !== null && typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[logicalValueSymbol] === true;
}

const signed64Minimum = -(1n << 63n);
const signed64Maximum = (1n << 63n) - 1n;

export function assertSafeInteger(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError("integer value must be a JavaScript safe integer");
  }
}

export function assertFiniteFloat(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("float value must be finite");
  }
}

export function assertDecimal(
  value: unknown,
  precision: number,
  scale: number,
): asserts value is string {
  if (typeof value !== "string" || !canonicalDecimal(value, scale)) {
    throw new TypeError(`decimal value must be canonical at scale ${scale}`);
  }
  const digits = significantScaledDigits(value);
  if (digits.length > precision) {
    throw new RangeError(`decimal value exceeds precision ${precision}`);
  }
  const scaled = decimalToScaled(value, precision, scale);
  if (scaled < signed64Minimum || scaled > signed64Maximum) {
    throw new RangeError("decimal value exceeds signed 64-bit storage");
  }
}

export function decimalToScaled(
  value: string,
  precision: number,
  scale: number,
): bigint {
  if (!canonicalDecimal(value, scale)) {
    throw new TypeError(`decimal value must be canonical at scale ${scale}`);
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = significantScaledDigits(`${whole}${fraction}`);
  if (digits.length > precision) {
    throw new RangeError(`decimal value exceeds precision ${precision}`);
  }
  const scaled = BigInt(digits);
  const result = negative ? -scaled : scaled;
  if (result < signed64Minimum || result > signed64Maximum) {
    throw new RangeError("decimal value exceeds signed 64-bit storage");
  }
  return result;
}

export function scaledToDecimal(value: bigint, scale: number): string {
  if (value < signed64Minimum || value > signed64Maximum) {
    throw new RangeError("scaled decimal exceeds signed 64-bit storage");
  }
  const negative = value < 0n;
  let digits = (negative ? -value : value).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, "0");
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return `${negative ? "-" : ""}${digits}`;
}

function canonicalDecimal(value: string, scale: number): boolean {
  if (value === "" || value.startsWith("+")) {
    return false;
  }
  const pattern = scale === 0 ? /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/ : new RegExp(
    `^-?(?:0|[1-9][0-9]*)\\.[0-9]{${scale}}$`,
  );
  return pattern.test(value) && !/^-0\.0+$/.test(value);
}

function significantScaledDigits(value: string): string {
  const digits = value.replace("-", "").replace(".", "").replace(
    /^0+/,
    "",
  );
  return digits || "0";
}

export function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export type TaggedDatabaseValue =
  | { type: "bigint"; value: string }
  | { type: "decimal"; value: string; precision: number; scale: number }
  | { type: "datetime"; value: string }
  | { type: "bytes"; value: string }
  | { type: "json"; value: unknown };

export type DatabaseValue =
  | null
  | boolean
  | number
  | string
  | TaggedDatabaseValue;

export function encodeDatabaseValue(
  value: unknown,
  logicalType?: LogicalType,
  precision?: number,
  scale?: number,
): DatabaseValue {
  if (isLogicalValue(value)) {
    return encodeDatabaseValue(
      value.value,
      value.logicalType,
      value.precision,
      value.scale,
    );
  }
  if (
    value === null || typeof value === "boolean" || typeof value === "string"
  ) {
    if (logicalType === "decimal") {
      assertDecimal(value, precision!, scale!);
      return { type: "decimal", value, precision: precision!, scale: scale! };
    }
    if (logicalType === "json") return { type: "json", value };
    return value;
  }
  if (typeof value === "number") {
    if (logicalType === "integer") assertSafeInteger(value);
    else assertFiniteFloat(value);
    return value;
  }
  if (typeof value === "bigint") {
    return { type: "bigint", value: value.toString() };
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError("invalid datetime");
    }
    return { type: "datetime", value: value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return { type: "bytes", value: bytesToBase64(value) };
  }
  if (logicalType === "json") return { type: "json", value };
  throw new TypeError(
    `unsupported database value ${Object.prototype.toString.call(value)}`,
  );
}

export function decodeDatabaseValue(value: DatabaseValue): unknown {
  if (value === null || typeof value !== "object") return value;
  switch (value.type) {
    case "bigint":
      return BigInt(value.value);
    case "decimal":
      assertDecimal(value.value, value.precision, value.scale);
      return value.value;
    case "datetime": {
      const result = new Date(value.value);
      if (!Number.isFinite(result.getTime())) {
        throw new TypeError("invalid datetime result");
      }
      return result;
    }
    case "bytes":
      return base64ToBytes(value.value);
    case "json":
      return value.value;
  }
}
