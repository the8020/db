// Pure helpers without dependencies: the browser shell shares them.

/**
 * Several values in one text field, such as `SK,CZ`. Backslash escapes the
 * separator, itself and each `escape` character, which keep a special meaning
 * in the field's own grammar (ranges, patterns). Arrays of scalar values need
 * no declaration; they hold several values by their schema.
 */
export interface FieldMultiple {
  separator: string;
  escape?: string;
}

export function validMultiple(multiple: FieldMultiple): void {
  if (
    typeof multiple.separator !== "string" ||
    [...multiple.separator].length !== 1 || multiple.separator === "\\" ||
    /\s/.test(multiple.separator) ||
    multiple.escape !== undefined &&
      (typeof multiple.escape !== "string" || multiple.escape.length > 32)
  ) {
    throw new TypeError(
      "multiple needs one non-space separator character other than backslash",
    );
  }
}

/**
 * Split text into its values, as written: escapes stay, surrounding spaces and
 * empty values are dropped. Joining them again preserves their meaning.
 */
export function splitMultiple(
  text: string,
  multiple: Pick<FieldMultiple, "separator">,
): string[] {
  const values: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === "\\" && index + 1 < text.length) {
      current += character + text[++index];
    } else if (character === multiple.separator) {
      values.push(current);
      current = "";
    } else current += character;
  }
  values.push(current);
  return values.map((value) => value.trim()).filter((value) => value !== "");
}

export function joinMultiple(
  values: readonly string[],
  multiple: Pick<FieldMultiple, "separator">,
): string {
  return values.join(multiple.separator);
}

/** One literal value as written in the text, with its specials escaped. */
export function escapeMultiple(value: string, multiple: FieldMultiple): string {
  const special = new Set([
    "\\",
    multiple.separator,
    ...(multiple.escape ?? ""),
  ]);
  let result = "";
  for (const character of value) {
    result += special.has(character) ? `\\${character}` : character;
  }
  // Leading and trailing spaces would be trimmed when splitting.
  return result.replace(/^ /, "\\ ").replace(/ $/, "\\ ");
}

/**
 * The literal a written value stands for, or undefined when it uses the
 * field's grammar (an unescaped special character), such as a range.
 */
export function multipleLiteral(
  written: string,
  multiple: FieldMultiple,
): string | undefined {
  const special = new Set([multiple.separator, ...(multiple.escape ?? "")]);
  let result = "";
  for (let index = 0; index < written.length; index++) {
    const character = written[index]!;
    if (character === "\\") {
      if (index + 1 >= written.length) return undefined;
      result += written[++index];
    } else if (special.has(character)) return undefined;
    else result += character;
  }
  return result;
}
