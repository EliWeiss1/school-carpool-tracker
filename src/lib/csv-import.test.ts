import { describe, expect, it } from "vitest";

import { parseRosterCsv } from "./csv-import";

describe("parseRosterCsv — header handling", () => {
  it("accepts headers in any column order", () => {
    const report = parseRosterCsv(
      "last_name,first_name,class_group\nCohen,Maya,K1\n",
    );

    expect(report.headerErrors).toEqual([]);
    expect(report.toImport).toEqual([
      {
        first_name: "Maya",
        last_name: "Cohen",
        aliases: [],
        class_group: "K1",
        carpool: null,
      },
    ]);
  });

  it("matches friendly header names case-insensitively", () => {
    const report = parseRosterCsv(
      'First Name,Last Name,Aliases,Class\nTheo,Ng,"Eng, Ang",K1\n',
    );

    expect(report.headerErrors).toEqual([]);
    expect(report.toImport[0]).toEqual({
      first_name: "Theo",
      last_name: "Ng",
      aliases: ["Eng", "Ang"],
      class_group: "K1",
      carpool: null,
    });
  });

  it("reads a carpool column under any of its friendly names", () => {
    const report = parseRosterCsv(
      "first_name,last_name,carpool\nMaya,Cohen,Weiss Carpool\nElias,Kohen,\n",
    );

    expect(report.toImport[0].carpool).toBe("Weiss Carpool");
    expect(report.toImport[1].carpool).toBeNull();
  });

  it("reports missing required columns and imports nothing", () => {
    const report = parseRosterCsv("class_group\nK1\n");

    expect(report.headerErrors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/first_name/i),
        expect.stringMatching(/last_name/i),
      ]),
    );
    expect(report.toImport).toEqual([]);
  });

  it("reports an empty file as a header error, not a crash", () => {
    const report = parseRosterCsv("");

    expect(report.headerErrors.length).toBeGreaterThan(0);
    expect(report.toImport).toEqual([]);
  });
});

describe("parseRosterCsv — row handling", () => {
  it("skips blank rows without treating them as errors", () => {
    const report = parseRosterCsv(
      "first_name,last_name\nMaya,Cohen\n\n   \nTheo,Ng\n",
    );

    expect(report.toImport).toHaveLength(2);
    expect(report.errors).toEqual([]);
    expect(report.blankRowsSkipped).toBe(2);
  });

  it("flags a row missing a required field with its row number, and skips it", () => {
    const report = parseRosterCsv(
      "first_name,last_name\nMaya,Cohen\n,NoFirstName\nTheo,\n",
    );

    expect(report.toImport).toHaveLength(1);
    expect(report.errors).toEqual([
      { rowNumber: 3, message: expect.stringMatching(/first name/i) },
      { rowNumber: 4, message: expect.stringMatching(/last name/i) },
    ]);
  });

  it("imports a row that stopped short, treating the missing columns as blank", () => {
    // Dropping trailing empty columns is normal exporter behaviour, not a
    // broken file. Erroring on it turned a 400-row import into 400 errors.
    const report = parseRosterCsv(
      "first_name,last_name,class_group\nMaya,Cohen,K1\nTheo,Ng\nNora,Chen,K1\n",
    );

    expect(report.toImport.map((s) => s.last_name)).toEqual([
      "Cohen",
      "Ng",
      "Chen",
    ]);
    expect(report.errors).toEqual([]);
    expect(report.toImport[1].class_group).toBeNull();
  });

  it("flags a row with MORE fields than the header, without crashing the rest of the file", () => {
    // This direction really is broken: the values no longer line up with the
    // column names, so there is no safe way to guess what was meant.
    const report = parseRosterCsv(
      "first_name,last_name,class_group\nMaya,Cohen,K1\nTheo,Ng,K1,extra\nNora,Chen,K1\n",
    );

    expect(report.toImport.map((s) => s.last_name)).toEqual(["Cohen", "Chen"]);
    expect(report.errors).toEqual([
      { rowNumber: 3, message: expect.stringMatching(/3 columns.*4/i) },
    ]);
  });

  it("flags duplicate full names and imports only the first occurrence", () => {
    const report = parseRosterCsv(
      "first_name,last_name\nMaya,Cohen\nElias,Kohen\nMaya,Cohen\n",
    );

    expect(
      report.toImport.map((s) => `${s.first_name} ${s.last_name}`),
    ).toEqual(["Maya Cohen", "Elias Kohen"]);
    expect(report.errors).toEqual([
      {
        rowNumber: 4,
        message: expect.stringMatching(/duplicate.*row 2/i),
      },
    ]);
  });

  it("treats duplicate names case-insensitively", () => {
    const report = parseRosterCsv(
      "first_name,last_name\nMaya,Cohen\nmaya,cohen\n",
    );

    expect(report.toImport).toHaveLength(1);
    expect(report.errors[0].rowNumber).toBe(3);
  });
});

describe("parseRosterCsv — aliases", () => {
  it("splits a semicolon-delimited alias list", () => {
    const report = parseRosterCsv(
      "first_name,last_name,aliases\nMaya,Cohen,Kohen;Cohn\n",
    );

    expect(report.toImport[0].aliases).toEqual(["Kohen", "Cohn"]);
  });

  it("drops blank entries from the alias list", () => {
    const report = parseRosterCsv(
      "first_name,last_name,aliases\nMaya,Cohen,Kohen;;Cohn;\n",
    );

    expect(report.toImport[0].aliases).toEqual(["Kohen", "Cohn"]);
  });

  it("defaults aliases to an empty list when the column is absent", () => {
    const report = parseRosterCsv("first_name,last_name\nMaya,Cohen\n");

    expect(report.toImport[0].aliases).toEqual([]);
  });
});

describe("parseRosterCsv — quoting, BOM, and line endings", () => {
  it("handles a quoted field containing a comma", () => {
    const report = parseRosterCsv(
      'first_name,last_name,aliases\nMaya,Cohen,"Kohen, Cohn"\n',
    );

    expect(report.toImport[0].aliases).toEqual(["Kohen", "Cohn"]);
  });

  it("handles an escaped quote inside a quoted field", () => {
    const report = parseRosterCsv(
      'first_name,last_name,class_group\nAva,O\'Brien-Smith,"Room ""B"""\n',
    );

    expect(report.toImport[0].class_group).toBe('Room "B"');
  });

  it("strips a UTF-8 BOM at the start of the file", () => {
    const report = parseRosterCsv("﻿first_name,last_name\nMaya,Cohen\n");

    expect(report.headerErrors).toEqual([]);
    expect(report.toImport).toHaveLength(1);
  });

  it("handles CRLF line endings", () => {
    const report = parseRosterCsv(
      "first_name,last_name\r\nMaya,Cohen\r\nTheo,Ng\r\n",
    );

    expect(report.toImport).toHaveLength(2);
    expect(report.toImport[1].last_name).toBe("Ng");
  });

  it("handles a quoted field that itself contains a CRLF", () => {
    const report = parseRosterCsv(
      'first_name,last_name,class_group\r\nMaya,Cohen,"Room 1\r\nAnnex"\r\n',
    );

    expect(report.toImport[0].class_group).toBe("Room 1\r\nAnnex");
  });
});

describe("parseRosterCsv — summary counts", () => {
  it("counts what will import, what is skipped, and why", () => {
    const report = parseRosterCsv(
      "first_name,last_name\nMaya,Cohen\n,Missing\nMaya,Cohen\n\nTheo,Ng\n",
    );

    expect(report.toImport).toHaveLength(2);
    expect(report.errors).toHaveLength(2);
    expect(report.blankRowsSkipped).toBe(1);
    expect(report.totalDataRows).toBe(5);
  });
});

describe("parseRosterCsv — malformed files must never import silently", () => {
  // The worst failure this parser can have is not a crash, it is a clean
  // bill of health on a file it did not fully read. One stray quotation mark
  // used to swallow every row after it into the field it opened, and the
  // report said "1 row, 1 will import, 0 errors".
  it("refuses a file whose quotation mark is never closed", () => {
    const report = parseRosterCsv(
      'first_name,last_name\nMaya,"Cohen\nTheo,Ng\nAva,Marsh\n',
    );

    expect(report.headerErrors.length).toBeGreaterThan(0);
    expect(report.headerErrors[0]).toMatch(/quotation mark/i);
    expect(report.toImport).toHaveLength(0);
  });

  it("does not swallow later rows into the field an unclosed quote opened", () => {
    const report = parseRosterCsv(
      'first_name,last_name\nMaya,"Cohen\nTheo,Ng\n',
    );

    expect(
      report.toImport.some((student) => student.last_name.includes("Theo")),
    ).toBe(false);
  });

  it("binds a field to its own column, not to whichever alias appears first", () => {
    // "last" and "last_name" are both aliases of last_name. Scanning the
    // file's columns for "any alias" let the wrong one win.
    const report = parseRosterCsv("last,first_name,last_name\nX,Maya,Cohen\n");

    expect(report.toImport[0]?.last_name).toBe("Cohen");
    expect(report.toImport[0]?.first_name).toBe("Maya");
  });

  it("pads a row that omits its trailing empty columns", () => {
    // Plenty of SIS exports drop trailing empties. Rejecting all 400 rows
    // with a column-count error is a report nobody can act on.
    const report = parseRosterCsv(
      "first_name,last_name,class_group\nMaya,Cohen\n",
    );

    expect(report.errors).toHaveLength(0);
    expect(report.toImport[0]).toMatchObject({
      first_name: "Maya",
      last_name: "Cohen",
      class_group: null,
    });
  });

  it("still rejects a row with more columns than the header", () => {
    const report = parseRosterCsv(
      "first_name,last_name\nMaya,Cohen,extra,more\n",
    );

    expect(report.errors).toHaveLength(1);
    expect(report.toImport).toHaveLength(0);
  });

  it("rejects a name too long to be a name rather than storing it", () => {
    // An unbounded name reaches the Deepgram keyterm list and the display
    // tile. Nothing between the file and Postgres bounded this.
    const report = parseRosterCsv(
      `first_name,last_name\nMaya,${"C".repeat(500)}\n`,
    );

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toMatch(/too long/i);
    expect(report.toImport).toHaveLength(0);
  });
});
