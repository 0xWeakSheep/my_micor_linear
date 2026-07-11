export type CsvScalar = string | number | boolean | null | undefined;

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

export function parseCsv(content: string, maxRows = 50_000): string[][] {
  const input = content.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      if (rows.length > maxRows) throw new CsvFormatError(`CSV exceeds ${maxRows} rows.`);
    } else {
      field += character;
    }
  }

  if (quoted) throw new CsvFormatError("CSV contains an unterminated quoted field.");
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (rows.length > maxRows) throw new CsvFormatError(`CSV exceeds ${maxRows} rows.`);
  return rows;
}

export function csvRecords(content: string): Array<Record<string, string>> {
  const [headerRow, ...rows] = parseCsv(content);
  if (!headerRow?.length) throw new CsvFormatError("CSV must include a header row.");
  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => !header)) throw new CsvFormatError("CSV headers cannot be empty.");
  const normalized = headers.map((header) => header.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new CsvFormatError("CSV headers must be unique.");
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function escapeCell(value: CsvScalar): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function stringifyCsv(
  headers: readonly string[],
  rows: readonly (readonly CsvScalar[])[],
): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n")}\r\n`;
}
