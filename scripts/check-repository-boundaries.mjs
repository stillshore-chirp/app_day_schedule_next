#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];

function walk(directory, extensions) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, extensions));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

const frontendRoot = path.join(root, 'apps/desktop/src');
const frontendFiles = walk(frontendRoot, new Set(['.ts', '.tsx', '.js', '.jsx']));
for (const file of frontendFiles) {
  if (path.basename(file) === 'AGENTS.md') continue;
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  const text = fs.readFileSync(file, 'utf8');
  const forbiddenPlugins = [
    '@tauri-apps/plugin-sql',
    '@tauri-apps/plugin-shell',
    '@tauri-apps/plugin-fs',
    '@tauri-apps/plugin-http',
  ];
  for (const plugin of forbiddenPlugins) {
    if (text.includes(plugin)) errors.push(`${relative}: frontend must not import ${plugin}`);
  }
  if (text.includes('@tauri-apps/api/core') && !relative.includes('/shared/ipc/')) {
    errors.push(`${relative}: raw Tauri invoke imports must be isolated under src/shared/ipc/`);
  }
}

const rustRoot = path.join(root, 'apps/desktop/src-tauri/src');
const rustFiles = walk(rustRoot, new Set(['.rs']));
for (const file of rustFiles) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  const text = fs.readFileSync(file, 'utf8');
  if (relative.includes('/domain/')) {
    const forbiddenDomainDependencies = ['tauri::', 'sqlx::', 'reqwest::', 'keyring::', 'tokio::', 'std::fs'];
    for (const dependency of forbiddenDomainDependencies) {
      if (text.includes(dependency)) errors.push(`${relative}: domain must not depend on ${dependency}`);
    }
  }
  if (text.includes('#[tauri::command]') && !relative.includes('/commands/')) {
    errors.push(`${relative}: Tauri commands must be declared under src/commands/`);
  }
}

const tauriConfig = path.join(root, 'apps/desktop/src-tauri/tauri.conf.json');
if (fs.existsSync(tauriConfig)) {
  const text = fs.readFileSync(tauriConfig, 'utf8');
  const forbiddenConfigFragments = [
    'shell:allow-execute',
    'shell:allow-spawn',
    'fs:allow-read',
    'fs:allow-write',
    'http:default',
    "script-src *",
    "default-src *",
  ];
  for (const fragment of forbiddenConfigFragments) {
    if (text.includes(fragment)) errors.push(`apps/desktop/src-tauri/tauri.conf.json: broad permission or CSP fragment: ${fragment}`);
  }
}

if (errors.length > 0) {
  console.error('Repository boundary verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

if (frontendFiles.length === 0 && rustFiles.length === 0) {
  console.log('Repository boundary verification passed: application source is not scaffolded yet; harness paths were checked.');
} else {
  console.log(`Repository boundary verification passed: ${frontendFiles.length} frontend and ${rustFiles.length} Rust files checked.`);
}
