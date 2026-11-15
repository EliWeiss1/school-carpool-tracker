/**
 * Delimited-text tokenizer and delimiter sniffer.
 *
 * Hand-rolled rather than a dependency for the same reason
 * `_shared/resolver.ts` is: a small, well-tested state machine is a smaller,
 * more auditable surface than a package for one file format, and RFC 4180
 * quoting is not a large rule set to get right once.
 */

export interface TokenizedCsv {
  rows: string[][];
  /**
   * True when end-of-file arrived with a quoted field still open. Everything
   * after the stray quote was absorbed into that one field, so the rows are
   * not what the file's author wrote and must not be imported.
   */
  unterminatedQuote: boolean;
}

/**
 * RFC 4180 tokenizer: quoted fields, `""` as an escaped quote, delimiters and
 * newlines inside quotes taken literally, and `\r\n`, `\n` or a lone `\r` as a
 * row terminator outside of quotes. A trailing terminator at end-of-file does
 * not manufacture a phantom empty row.
 */
export function tokenizeCsv(text: string, delimiter = ","): TokenizedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      pushRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Only flush a final row if something was actually read since the last
  // terminator -- otherwise a trailing newline would add an empty row nobody
  // typed.
  if (field !== "" || row.length > 0) {
    pushRow();
  }

  return { rows, unterminatedQuote: inQuotes };
}

/** Comma first: on a tie it is the overwhelmingly common case. */
const CANDIDATES = [",", "\t", ";", "|"] as const;
export type Delimiter = (typeof CANDIDATES)[number];

/** Enough rows to see a pattern; reading further only costs time. */
const SNIFF_SAMPLE_CHARS = 20_000;
const SNIFF_ROWS = 25;

/**
 * Picks the delimiter that splits the sampled rows into the most consistent
 * number of columns (more than one). A Google Sheets paste is tab-separated,
 * a European Excel "CSV" is semicolon-separated, and both should just work.
 */
export function sniffDelimiter(text: string): Delimiter {
  const sample = text.slice(0, SNIFF_SAMPLE_CHARS);
  let best: { delimiter: Delimiter; score: number } = {
    delimiter: ",",
    score: 0,
  };

  for (const delimiter of CANDIDATES) {
    const rows = tokenizeCsv(sample, delimiter)
      .rows.filter((row) => row.some((cell) => cell.trim() !== ""))
      .slice(0, SNIFF_ROWS);
    if (rows.length === 0) continue;

    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    }
    let modeWidth = 1;
    let modeCount = 0;
    for (const [width, count] of counts) {
      if (count > modeCount || (count === modeCount && width > modeWidth)) {
        modeWidth = width;
        modeCount = count;
      }
    }
    if (modeWidth < 2) continue;

    // Consistency first, then width as a gentle tiebreak: a delimiter that
    // splits every row into 4 beats one that splits most rows into 2.
    const score = modeCount / rows.length + modeWidth / 1000;
    if (score > best.score) best = { delimiter, score };
  }

  return best.delimiter;
}
