// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answer as csv-reader 1.0.0 for every input {text, header}: the JSON
// value {columns, rows, errors}. Same broken-row policy, in the same order:
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and an
// empty line is no record; outside quotes a CR not followed by LF is dropped
// (stray_cr); a field that opens with a quote runs to the next quote that is
// not doubled, "" inside it is one quote and each CRLF or lone CR inside it
// is read as LF; what follows its closing quote, up to the next comma or line
// break, is appended as it stands (quote_junk, when the field ends); a quote
// that never closes is a literal character and the text after it is read
// again as unquoted (unterminated_quote); a quote inside an unquoted field
// is a literal character; fields stay strings, never trimmed or converted.
// columns is the first record when header is true, else null; rows holds the
// records after it, each padded with "" (short_row, with fields: its count)
// or cut (long_row, with extra: the cut fields) to the first record's width.
// Each error is {code, line, row}: line the 1-based line its record starts
// on, row its record's index in rows (null for the header), in the order met.
//
// How it is fast: the reference reads one character at a time and builds
// each field a character at a time. This one never loops over plain text
// character by character. An unquoted field is cut with two C++ scans
// (indexOf ',' and '\n') and one slice, inlined in the record loop so there
// is no call and no result array per field; a quoted field is cut with
// indexOf '"' per segment and one slice per segment, and only a segment that
// holds a line break is walked character by character, to count its breaks
// and turn each CRLF or lone CR into LF. A CR is never hunted with an
// unbounded scan: the field's own slice is checked for it, and the rare
// stray CR falls back to the careful path. No dependencies, no WebAssembly,
// no native addon, no prebuilt binary, nothing kept from one call to the
// next.
//
// ended: 0 = comma (the record goes on), 1 = line break (the record ends),
// 2 = end of the text (the record ends).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = typeof input.text === 'string' ? input.text : String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Errors of the record carry these two.
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field from pos, starting from `value` ('' normally,
  // '"' when re-reading after a quote that never closed, or a quoted value
  // whose closing quote is followed by junk). Returns [value, ended, added]:
  // added counts the characters kept here, not the ones `value` already
  // held, so a caller can tell quote junk from nothing. Only used on the
  // rare paths (junk after a closing quote, re-read after an unterminated
  // quote, a stray CR inside a field); the common unquoted field is inlined
  // in the record loop below.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const iComma = text.indexOf(',', pos);
      const iLF = text.indexOf('\n', pos);
      let end;
      let isComma;
      if (iComma === -1) {
        end = iLF;
        isComma = false;
      } else if (iLF === -1) {
        end = iComma;
        isComma = true;
      } else if (iComma < iLF) {
        end = iComma;
        isComma = true;
      } else {
        end = iLF;
        isComma = false;
      }
      if (end === -1) {
        // No delimiter left: the tail is one slice; only a stray CR in it
        // needs the careful walk.
        const seg = pos < n ? text.slice(pos, n) : '';
        if (seg.indexOf('\r') === -1) {
          value += seg;
          added += seg.length;
          pos = n;
          return [value, END, added];
        }
        for (let i = 0; i < seg.length; i++) {
          const ch = seg.charCodeAt(i);
          if (ch === 13) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          } else {
            value += seg[i];
            added += 1;
          }
        }
        pos = n;
        return [value, END, added];
      }
      if (!isComma && end > pos && text.charCodeAt(end - 1) === 13) {
        // CRLF: the CR sits right before the LF that ends the field. The
        // span before it may still hide a stray CR: check it first.
        const seg2 = end - 1 > pos ? text.slice(pos, end - 1) : '';
        if (seg2.indexOf('\r') === -1) {
          value += seg2;
          added += seg2.length;
          pos = end + 1;
          line += 1;
          return [value, LINE_BREAK, added];
        }
        for (let i = 0; i < seg2.length; i++) {
          const ch = seg2.charCodeAt(i);
          if (ch === 13) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          } else {
            value += seg2[i];
            added += 1;
          }
        }
        pos = end + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      const seg = end > pos ? text.slice(pos, end) : '';
      if (seg.indexOf('\r') === -1) {
        value += seg;
        added += seg.length;
        if (isComma) {
          pos = end + 1;
          return [value, COMMA, added];
        }
        pos = end + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      // A stray CR hides in the span: walk the slice, dropping CRs.
      for (let i = 0; i < seg.length; i++) {
        const ch = seg.charCodeAt(i);
        if (ch === 13) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        } else {
          value += seg[i];
          added += 1;
        }
      }
      pos = end + 1;
      if (isComma) return [value, COMMA, added];
      line += 1;
      return [value, LINE_BREAK, added];
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended;
    do {
      if (text.charCodeAt(pos) === 34) {
        // A quoted field: its opening quote is at pos.
        quoted = true;
        const open = pos;
        const openLine = line;
        let value = '';
        pos += 1;
        let closed = false;
        while (pos < n) {
          const q = text.indexOf('"', pos);
          if (q === -1) break; // no closing quote: unterminated, below
          // The segment [pos, q): one slice, then only walk it when it
          // holds a line break.
          const seg = q > pos ? text.slice(pos, q) : '';
          if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
            let chunk = '';
            for (let i = 0; i < seg.length; i++) {
              const ch = seg.charCodeAt(i);
              if (ch === 13) {
                chunk += '\n';
                line += 1;
                if (i + 1 < seg.length && seg.charCodeAt(i + 1) === 10) i += 1;
              } else if (ch === 10) {
                chunk += '\n';
                line += 1;
              } else {
                chunk += seg[i];
              }
            }
            value += chunk;
          } else {
            value += seg;
          }
          if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
            value += '"';
            pos = q + 2;
            continue;
          }
          pos = q + 1;
          closed = true;
          break;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquoted('"');
          fields.push(r[0]);
          ended = r[1];
          continue;
        }
        if (pos >= n) {
          fields.push(value);
          ended = END;
          continue;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fields.push(value);
          ended = COMMA;
        } else if (c === 10) {
          pos += 1;
          line += 1;
          fields.push(value);
          ended = LINE_BREAK;
        } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fields.push(value);
          ended = LINE_BREAK;
        } else {
          // What follows the closing quote is appended as it stands, up to
          // the next comma or line break.
          const r = readUnquoted(value);
          if (r[2] > 0) {
            errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
          fields.push(r[0]);
          ended = r[1];
        }
      } else {
        // Unquoted field, inlined: two C++ scans and one slice.
        quoted = false;
        let value = '';
        for (;;) {
          const iComma = text.indexOf(',', pos);
          const iLF = text.indexOf('\n', pos);
          let end;
          let isComma;
          if (iComma === -1) {
            end = iLF;
            isComma = false;
          } else if (iLF === -1) {
            end = iComma;
            isComma = true;
          } else if (iComma < iLF) {
            end = iComma;
            isComma = true;
          } else {
            end = iLF;
            isComma = false;
          }
          if (end === -1) {
            const seg = pos < n ? text.slice(pos, n) : '';
            if (seg.indexOf('\r') === -1) {
              value += seg;
              pos = n;
              fields.push(value);
              ended = END;
              break;
            }
            const r = readUnquoted(value);
            fields.push(r[0]);
            ended = r[1];
            break;
          }
          if (!isComma && end > pos && text.charCodeAt(end - 1) === 13) {
            const seg2 = end - 1 > pos ? text.slice(pos, end - 1) : '';
            if (seg2.indexOf('\r') === -1) {
              if (seg2.length > 0) value += seg2;
              pos = end + 1;
              line += 1;
              fields.push(value);
              ended = LINE_BREAK;
              break;
            }
            // A stray CR hides just before the CRLF: the careful path
            // re-reads the field.
            const r = readUnquoted(value);
            fields.push(r[0]);
            ended = r[1];
            break;
          }
          const seg = end > pos ? text.slice(pos, end) : '';
          if (seg.indexOf('\r') === -1) {
            value += seg;
            if (isComma) {
              pos = end + 1;
              fields.push(value);
              ended = COMMA;
            } else {
              pos = end + 1;
              line += 1;
              fields.push(value);
              ended = LINE_BREAK;
            }
            break;
          }
          // A stray CR hides in the span: the careful path re-reads it.
          const r = readUnquoted(value);
          fields.push(r[0]);
          ended = r[1];
          break;
        }
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
