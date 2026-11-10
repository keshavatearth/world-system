#!/usr/bin/env node
// Filesystem → world.json projection. Read-only; the map is a view, never the canon.
import { readdirSync, statSync, existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const SKIP_NAMES = new Set([
  "Library", ".Trash", "node_modules", ".git", "Applications", "Public",
  ".DS_Store", ".localized", ".cache", ".npm", ".nvm", ".bun", ".local",
  "DerivedData", "__pycache__", ".venv", "venv", "dist", "build",
]);

function listDir(p) {
  try {
    return readdirSync(p, { withFileTypes: true }).filter(
      (d) => !d.name.startsWith(".DS_Store") && d.name !== ".localized"
    );
  } catch {
    return [];
  }
}

function mtimeOf(p) {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}

function gitInfo(p) {
  if (!existsSync(join(p, ".git"))) return null;
  try {
    const dirty = execSync(
      `git -C "${p}" status --porcelain --untracked-files=no 2>/dev/null | head -1`,
      { timeout: 4000 }
    ).toString().trim().length > 0;
    return { repo: true, dirty };
  } catch {
    return { repo: true, dirty: false };
  }
}

// depth-2 weighted count: direct children + sum of grandchildren (bounded, fast)
function weightOf(p, entries) {
  let w = entries.length;
  for (const e of entries.slice(0, 400)) {
    if (e.isDirectory() && !SKIP_NAMES.has(e.name) && !e.name.startsWith("."))
      w += listDir(join(p, e.name)).length;
  }
  return w;
}

function childRecord(parent, e) {
  const p = join(parent, e.name);
  const isDir = e.isDirectory();
  const items = isDir ? listDir(p) : [];
  return {
    name: e.name,
    path: p,
    isDir,
    itemCount: items.length,
    mtime: mtimeOf(p),
    git: isDir ? gitInfo(p) : null,
  };
}

const now = Date.now();
const rootEntries = listDir(HOME);
const entries = [];

for (const e of rootEntries) {
  if (!e.isDirectory() || SKIP_NAMES.has(e.name)) continue;
  const p = join(HOME, e.name);
  const isDot = e.name.startsWith(".");
  const items = listDir(p);
  const kind = ["Desktop", "Downloads"].includes(e.name)
    ? "major"
    : ["Documents", "Movies", "Music", "Pictures"].includes(e.name)
    ? "area"
    : isDot
    ? "dot"
    : "root";
  const children = items
    .filter((c) => c.isDirectory() && !SKIP_NAMES.has(c.name))
    .map((c) => childRecord(p, c))
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, kind === "major" ? 40 : 14);
  entries.push({
    name: e.name,
    path: p,
    kind,
    isHQ: e.name === "Desktop" ? false : undefined,
    itemCount: items.length,
    weight: isDot ? Math.min(items.length, 40) : weightOf(p, items),
    mtime: mtimeOf(p),
    git: gitInfo(p),
    children,
  });
}

// mark HQ: world-system inside Desktop's children
for (const ent of entries)
  for (const c of ent.children || [])
    if (c.name === "world-system") c.isHQ = true;

const world = { generatedAt: new Date(now).toISOString(), root: HOME, entries };
writeFileSync(new URL("./public/world.json", import.meta.url), JSON.stringify(world, null, 1));
console.log(
  `world.json: ${entries.length} landmasses, ` +
  `${entries.reduce((n, e) => n + (e.children?.length || 0), 0)} buildings`
);
