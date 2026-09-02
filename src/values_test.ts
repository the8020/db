import {
  assertDecimal,
  assertSafeInteger,
  base64ToBytes,
  bytesToBase64,
  decimalToScaled,
  decodeDatabaseValue,
  encodeDatabaseValue,
  scaledToDecimal,
} from "./values.ts";
import { assertEquals, assertThrows } from "@std/assert";

Deno.test("decimal values are exact canonical scaled strings", () => {
  assertDecimal("125.50", 5, 2);
  assertEquals(decimalToScaled("125.50", 5, 2), 12550n);
  assertEquals(decimalToScaled("0.50", 2, 2), 50n);
  assertEquals(decimalToScaled("-0.50", 2, 2), -50n);
  assertEquals(scaledToDecimal(-12550n, 2), "-125.50");
  assertEquals(
    decimalToScaled("999999999999999999", 18, 0),
    999999999999999999n,
  );
  assertThrows(() => assertDecimal("125.5", 5, 2));
  assertThrows(() => assertDecimal("01.25", 5, 2));
  assertThrows(() => assertDecimal("-0.00", 2, 2));
  assertThrows(() => assertDecimal("1000.00", 5, 2));
  assertThrows(() => assertDecimal("1000000000000000000", 18, 0));
  assertThrows(() => decimalToScaled("9223372036854775808", 19, 0));
});

Deno.test("database values use explicit lossless tags", () => {
  const bytes = new Uint8Array([0, 1, 254, 255]);
  assertEquals(base64ToBytes(bytesToBase64(bytes)), bytes);
  assertEquals(decodeDatabaseValue(encodeDatabaseValue(bytes)), bytes);
  assertEquals(
    decodeDatabaseValue(encodeDatabaseValue(new Date("2026-01-02T03:04:05Z"))),
    new Date("2026-01-02T03:04:05Z"),
  );
  assertEquals(decodeDatabaseValue({ type: "bigint", value: "17" }), 17n);
});

Deno.test("integer values are limited to the JavaScript safe range", () => {
  assertSafeInteger(Number.MAX_SAFE_INTEGER);
  assertThrows(() => assertSafeInteger(Number.MAX_SAFE_INTEGER + 1));
  assertThrows(() => encodeDatabaseValue(Number.POSITIVE_INFINITY));
});
