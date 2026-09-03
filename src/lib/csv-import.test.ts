import { describe, expect, it } from "vitest";

import { parseRosterCsv } from "./csv-import";

describe("parseRosterCsv — header handling", () => {
  it("accepts headers in any column order", () => {
    const report = parseRosterCsv(
      "last_name,grade,first_name,class_group\nCohen,K,Maya,K-Alvarez\n",
    );

    expect(report.headerErrors).toEqual([]);
    expect(report.toImport).toEqual([
      {
        first_name: "Maya",
        last_name: "Cohen",
        aliases: [],
        grade: "K",
        class_group: "K-Alvarez",
      },
    ]);
  });

  it("matches friendly header names case-insensitively", () => {
    const report = parseRosterCsv(
      "First Name,Last Name,Aliases,Grade,Class\nTheo,Ng,\"Eng, Ang\",K,K-Alvarez\n",
    );

    expect(report.headerErrors).toEqual([]);
    expect(report.toImport[0]).toEqual({
      first_name: "Theo",
      last_name: "Ng",
      aliases: ["Eng", "Ang"],
      grade: "K",
      class_group: "K-Alvarez",
    });
  });

  it("reports missing required columns and imports nothing", () => {
    const report = parseRosterCsv("grade,class_group\nK,K-Alvarez\n");

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

  it("flags a row with the wrong number of fields as broken, without crashing the rest of the file", () => {
    const report = parseRosterCsv(
      "first_name,last_name,grade\nMaya,Cohen,K\nTheo,Ng\nNora,Chen,K\n",
    );

    expect(report.toImport.map((s) => s.last_name)).toEqual(["Cohen", "Chen"]);
    expect(report.errors).toEqual([
      { rowNumber: 3, message: expect.stringMatching(/3 columns.*2/i) },
    ]);
  });

  it("flags duplicate full names and imports only the first occurrence", () => {
    const report = parseRosterCsv(
      "first_name,last_name\nMaya,Cohen\nElias,Kohen\nMaya,Cohen\n",
    );

    expect(report.toImport.map((s) => `${s.first_name} ${s.last_name}`)).toEqual(
      ["Maya Cohen", "Elias Kohen"],
    );
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
    const report = parseRosterCsv(
      "﻿first_name,last_name\nMaya,Cohen\n",
    );

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
