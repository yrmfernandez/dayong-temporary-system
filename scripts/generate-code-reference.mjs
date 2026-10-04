import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Read-only source scan; the only output written is docs/code-reference.md.
const root = process.cwd();
const slash = (p) => p.replaceAll("\\", "/");
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = slash(path.join(dir, entry.name));
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = ["app", "components", "lib", "scripts", "config", "public"].flatMap(walk)
  .concat(["proxy.ts", "next.config.ts", "eslint.config.mjs", "postcss.config.mjs", "tsconfig.json", "components.json", "package.json", ".env.example"])
  .filter((file) => /\.(?:[cm]?[jt]sx?|json|css|txt)$/.test(file) || file === ".env.example").sort();
const escape = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const link = (file) => `[${file}](../${file})`;
const sources = files.map((file) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = [], exports = [];
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) imports.push(statement.moduleSpecifier.text);
    if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (statement.name) exports.push(statement.name.text);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) exports.push(declaration.name.getText(ast));
      if (statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) exports.push("default");
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) exports.push(...statement.exportClause.elements.map((element) => element.name.text));
      if (statement.moduleSpecifier) imports.push(statement.moduleSpecifier.text);
    }
  }
  return { file, source, imports: [...new Set(imports)], exports: [...new Set(exports)] };
});
const pages = sources.filter(({ file }) => /\/page\.tsx$/.test(file));
const routes = sources.filter(({ file }) => /^app\/api\/.*\/route\.ts$/.test(file));
const lines = ["# Dayong System code reference", "", "Generated from the repository source on 2026-10-04. Start with the [system guide](system-guide.md) for explanations and worked examples. This index covers source files, exported functions/types/constants, local dependencies, API methods, and maintenance scripts. It does not inspect credentials, dependencies in node_modules, binary assets, or the live workbook. Export names and import connections are extracted with the TypeScript parser; they are navigation aids, not a proof that every path is used at runtime.", "", "Regenerate from the repository root with `node scripts/generate-code-reference.mjs` after changes. Update the review date in this script when performing a new review.", "", "## Coverage", "", `${pages.length} page routes, ${routes.length} API handlers, ${sources.filter(({ file }) => file.startsWith("lib/")).length} library files, ${sources.filter(({ file }) => file.startsWith("components/")).length} component files; ${files.length} scanned source/configuration/public-text files in total.`, "", "## Page routes", "", "| Page | Source | Local dependencies |", "| --- | --- | --- |"];
for (const item of pages) lines.push(`| \`${item.file.replace(/^app/, "").replace(/\/page\.tsx$/, "") || "/"}\` | ${link(item.file)} | ${escape(item.imports.filter((s) => s.startsWith("@/")).map((s) => `\`${s}\``).join(", "))} |`);
lines.push("", "## API routes", "", "All routes pass through the authentication proxy except the three public auth endpoints. Methods below are implemented exports; permission and validation details remain in each linked handler.", "", "| API | Methods | Source |", "| --- | --- | --- |");
for (const item of routes) lines.push(`| \`${item.file.replace(/^app/, "").replace(/\/route\.ts$/, "")}\` | ${item.exports.filter((s) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(s)).join(", ")} | ${link(item.file)} |`);
for (const [title, predicate] of [["Libraries and business rules", (f) => f.startsWith("lib/")], ["Components and UI connections", (f) => f.startsWith("components/")], ["API dependencies", (f) => /^app\/api\//.test(f)], ["Page support files and root configuration", (f) => !/^(lib|components|scripts|config|public)\//.test(f) && !/\/page\.tsx$/.test(f) && !/^app\/api\//.test(f)]]) {
  lines.push("", `## ${title}`, "", "| File | Exported symbols | Local imports / re-exports |", "| --- | --- | --- |");
  for (const item of sources.filter(({ file }) => predicate(file))) lines.push(`| ${link(item.file)} | ${escape(item.exports.map((s) => `\`${s}\``).join(", ") || "—")} | ${escape(item.imports.filter((s) => s.startsWith("@/") || s.startsWith(".")).map((s) => `\`${s}\``).join(", ") || "—")} |`);
}
lines.push("", "## Maintenance scripts", "", "These are an inventory, not instructions to run every script. Read each script's flags and affected sheets first. Migration, repair, import, and correction scripts can change real business data when configured against a workbook.", "", "| Script | Imports | Supports literal --apply flag |", "| --- | --- | --- |");
for (const item of sources.filter(({ file }) => file.startsWith("scripts/"))) lines.push(`| ${link(item.file)} | ${escape(item.imports.map((s) => `\`${s}\``).join(", ") || "See source")} | ${item.source.includes("--apply") ? "Yes; read source for semantics" : "No flag detected; read source before running"} |`);
lines.push("", "## Configuration and public text files", "");
for (const item of sources.filter(({ file }) => /^(config|public)\//.test(file))) lines.push(`- ${link(item.file)}`);
fs.writeFileSync(path.join(root, "docs", "code-reference.md"), lines.join("\n") + "\n", "utf8");
console.log(`Wrote docs/code-reference.md from ${files.length} source files (${pages.length} pages, ${routes.length} APIs).`);
