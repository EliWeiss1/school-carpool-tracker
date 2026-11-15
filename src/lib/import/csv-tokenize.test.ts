import { describe, expect, it } from "vitest";

import { sniffDelimiter, tokenizeCsv } from "./csv-tokenize";

describe("tokenizeCsv", () => {
  it("splits plain rows and ignores a trailing newline", () => {
    expect(tokenizeCsv("a,b\n1,2\n")).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      unterminatedQuote: false,
    });
  });

  it("handles quotes, escaped quotes and newlines inside quotes", () => {
    const { rows } = tokenizeCsv('a,b\r\n"x, y","say ""hi""\nthere"\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });

  it("flags an unterminated quote", () => {
    expect(tokenizeCsv('a,b\n"oops,1\n2,3').unterminatedQuote).toBe(true);
  });

  it("accepts a lone carriage return as a row break", () => {
    expect(tokenizeCsv("a,b\r1,2").rows).toHaveLength(2);
  });
});

describe("sniffDelimiter", () => {
  it("picks comma", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3\n4,5,6")).toBe(",");
  });
  it("picks tab (Google Sheets paste)", () => {
    expect(sniffDelimiter("first\tlast\tclass\nMaya\tCohen\tK1")).toBe("\t");
  });
  it("picks semicolon (European Excel)", () => {
    expect(sniffDelimiter("first;last;class\nMaya;Cohen;K1")).toBe(";");
  });
  it("picks pipe", () => {
    expect(sniffDelimiter("first|last|class\nMaya|Cohen|K1")).toBe("|");
  });
  it("is not fooled by quoted commas inside a semicolon file", () => {
    const text =
      'name;aliases;class\n"Cohen, Maya";"Mia, Maya";K1\n"Levy, Yosef";"Yossi, Joe";2nd';
    expect(sniffDelimiter(text)).toBe(";");
  });
  it("falls back to comma for a one-column file", () => {
    expect(sniffDelimiter("Cohen\nLevy\nKatz")).toBe(",");
  });
});
