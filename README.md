# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/unuserv01-lab/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/unuserv01-lab/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` returns
exactly csv-reader's answer — `{columns, rows, errors}` — for every input
`{text, header}`, under its written broken-row policy (BOM dropped, empty
lines are no records, stray CRs recorded and dropped, quoted fields with
`""` escapes and CR/LF read as LF, quote junk after a closing quote,
unterminated quotes re-read as unquoted, short rows padded and long rows
cut, every error recorded with its line and row).

The reference reads one character at a time and builds each field a
character at a time. This one never walks plain text character by character:
an unquoted field is cut with two C++ scans (`indexOf` for `,` and `\n`)
and one slice; a quoted field is cut with `indexOf('"')` per segment and one
slice per segment, and only a segment that holds a line break is walked
character by character. Pure JavaScript, dependency-free, no WebAssembly,
no native addon, no prebuilt binary, nothing cached from one case to the
next.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<cases-dir> MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads every case from `<cases-dir>/cases.json`, answers each one
alone with `run`, and writes `out/answers.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=n8hpxggx&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)</sub>
