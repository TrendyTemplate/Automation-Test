import { describe, expect, it } from "vitest";
import { toCsv } from "../app/lib/csv";

describe("F10 CSV export", () => {
  it("quotes, escapes and neutralises formulas", () => {
    const csv = toCsv(["Order", "Note", "Value"], [
      ["#1", 'He said "hi", ok', 10],
      ["#2", "=HYPERLINK(\"x\")", null],
      ["#3", "line\nbreak", -5],
    ]);
    expect(csv).toBe(
      'Order,Note,Value\r\n#1,"He said ""hi"", ok",10\r\n#2,"\'=HYPERLINK(""x"")",\r\n#3,"line\nbreak",-5\r\n',
    );
  });
});
