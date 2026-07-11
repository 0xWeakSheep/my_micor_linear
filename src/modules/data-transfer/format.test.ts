import { describe, expect, it } from "vitest";

import { CsvFormatError, csvRecords, parseCsv, stringifyCsv } from "./format";

describe("CSV formatting", () => {
  it("round-trips commas, quotes and newlines", () => {
    const content = stringifyCsv(["Title", "Description"], [["A, B", "Line 1\n\"Line 2\""]]);
    expect(csvRecords(content)).toEqual([
      { Title: "A, B", Description: "Line 1\n\"Line 2\"" },
    ]);
  });

  it("rejects malformed quoted fields", () => {
    expect(() => parseCsv('Title\n"never closed')).toThrow(CsvFormatError);
  });

  it("rejects duplicate headers ignoring case", () => {
    expect(() => csvRecords("Title,title\nA,B")).toThrow("headers must be unique");
  });
});
