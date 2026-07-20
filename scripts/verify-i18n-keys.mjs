import fs from "node:fs";
import path from "node:path";
import ts from "../apps/desktop/node_modules/typescript/lib/typescript.js";

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

for (const file of sourceFiles(sourceRoot)) {
  const sourceText = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    const text =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)
        ? node.text
        : ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
          ? node.text
          : null;
    if (text && (japanese.test(text) || text === "ja-JP")) {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push(
        `${path.relative(process.cwd(), file)}:${location.line + 1}:${location.character + 1}`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (violations.length > 0) {
  console.error(
    "UIの日本語文言と日時ロケールは shared/i18n/messages.ts の翻訳設定へ移してください:",
  );
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("i18n key audit passed: production UI Japanese is centralized in messages.ts");
