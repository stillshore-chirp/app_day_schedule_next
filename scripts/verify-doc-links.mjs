#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', 'target', 'dist', 'coverage', 'artifacts', 'release']);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolute);
  }
  return files;
}

function stripFencedCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
}

const errors = [];
let checked = 0;
for (const absolute of walk(root)) {
  const relative = path.relative(root, absolute);
  const text = stripFencedCode(fs.readFileSync(absolute, 'utf8'));
  const linkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(linkRegex)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (/^(https?:|mailto:|tel:|data:)/i.test(target) || target.startsWith('#')) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      errors.push(`${relative}: invalid URL encoding in link ${match[1]}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(absolute), target);
    checked += 1;
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      errors.push(`${relative}: link escapes repository: ${match[1]}`);
      continue;
    }
    if (!fs.existsSync(resolved)) errors.push(`${relative}: missing local link target: ${match[1]}`);
  }
}

if (errors.length > 0) {
  console.error('Documentation link verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Documentation link verification passed: ${checked} local links checked.`);
