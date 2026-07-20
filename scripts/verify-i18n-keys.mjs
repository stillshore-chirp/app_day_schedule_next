import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve("apps/desktop/src");
const catalogPath = path.join(sourceRoot, "shared/i18n/messages.ts");
const japanese = /[ぁ-んァ-ヶ一-龠]/;
const violations = [];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
    if (target === catalogPath || target.includes(`${path.sep}test${path.sep}`)) return [];
    return [target];
  });
}

function auditSource(file, sourceText) {
  let state = "code";
  let escaped = false;
  let line = 1;
  let column = 1;
  const reportedLines = new Set();

  const report = () => {
    if (reportedLines.has(line)) return;
    reportedLines.add(line);
    violations.push(`${path.relative(process.cwd(), file)}:${line}:${column}`);
  };

  for (let index = 0; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    const next = sourceText[index + 1];

    if (state === "line-comment") {
      if (character === "\n") state = "code";
    } else if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
        column += 1;
      }
    } else if (state === "code") {
      if (character === "/" && next === "/") {
        state = "line-comment";
        index += 1;
        column += 1;
      } else if (character === "/" && next === "*") {
        state = "block-comment";
        index += 1;
        column += 1;
      } else if (character === "\"" || character === "'" || character === "`") {
        state = character;
        escaped = false;
      } else if (japanese.test(character)) {
        report();
      }
    } else if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === state) {
      state = "code";
    } else if (japanese.test(character) || sourceText.startsWith("ja-JP", index)) {
      report();
    }

    if (character === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
}

for (const file of sourceFiles(sourceRoot)) {
  const sourceText = fs.readFileSync(file, "utf8");
  auditSource(file, sourceText);
}

if (violations.length > 0) {
  console.error(
    "UIの日本語文言と日時ロケールは shared/i18n/messages.ts の翻訳設定へ移してください:",
  );
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("i18n key audit passed: production UI Japanese is centralized in messages.ts");
