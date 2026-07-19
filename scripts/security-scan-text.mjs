#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git', 'node_modules', 'target', 'dist', 'coverage', 'playwright-report', 'test-results', 'artifacts', 'release',
]);
const ignoredFiles = new Set(['scripts/security-scan-text.mjs']);
const textExtensions = new Set([
  '.md', '.txt', '.json', '.jsonc', '.toml', '.yaml', '.yml', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.sql',
  '.html', '.css', '.scss', '.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat', '.env', '.example', '.gitignore', '.gitattributes', '.editorconfig',
]);

function shouldScan(file) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  if (ignoredFiles.has(relative)) return false;
  const extension = path.extname(file).toLowerCase();
  if (textExtensions.has(extension)) return true;
  return ['LICENSE', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'SECURITY.md', 'OPERATIONS.md'].includes(path.basename(file));
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && shouldScan(absolute)) files.push(absolute);
  }
  return files;
}

const secretPatterns = [
  ['private key header', new RegExp('-----BEGIN ' + '(?:RSA |EC |OPENSSH )?PRIVATE KEY-----')],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['Bearer token', /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b/],
  ['JSON client secret', /"client_secret"\s*:\s*"(?!<|YOUR_|example|dummy|test|redacted)[^"\n]{8,}"/i],
  ['refresh token assignment', /\brefresh_token\b\s*[:=]\s*["'](?!<|YOUR_|example|dummy|test|redacted)[^"'\n]{12,}["']/i],
  ['access token assignment', /\baccess_token\b\s*[:=]\s*["'](?!<|YOUR_|example|dummy|test|redacted)[^"'\n]{12,}["']/i],
  ['password assignment', /\bpassword\b\s*[:=]\s*["'](?!<|YOUR_|example|dummy|test|redacted)[^"'\n]{8,}["']/i],
];
const invisibleControls = /[\u202A-\u202E\u2066-\u2069\u200B\u200C\u200D\uFEFF]/;

const errors = [];
let scanned = 0;
for (const absolute of walk(root)) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
  let text;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }
  scanned += 1;
  if (invisibleControls.test(text)) errors.push(`${relative}: contains invisible or bidirectional Unicode control`);
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) errors.push(`${relative}: possible ${label}`);
  }
}

if (errors.length > 0) {
  console.error('Security text scan failed. Values are not printed to avoid secondary disclosure:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Security text scan passed: ${scanned} text files scanned.`);
