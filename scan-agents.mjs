#!/usr/bin/env node
// Real agent detection: recent session activity in ~/.claude and ~/.codex → agents.json
// Status: active <10m · waiting 10-30m · idle <24h. No lore pawns — disk truth only.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const now = Date.now();
const M = 60000;

function statusFor(age) {
  if (age < 10 * M) return "active";
  if (age < 30 * M) return "waiting";
  if (age < 24 * 60 * M) return "idle";
  return null;
}

const agents = [];

// Claude Code sessions: ~/.claude/projects/<slug>/<uuid>.jsonl — slug encodes cwd
const cproj = join(HOME, ".claude", "projects");
if (existsSync(cproj)) {
  for (const dir of readdirSync(cproj)) {
    const p = join(cproj, dir);
    let best = null;
    try {
      for (const f of readdirSync(p)) {
        if (!f.endsWith(".jsonl")) continue;
        const m = statSync(join(p, f)).mtimeMs;
        if (!best || m > best.m) best = { m, f };
      }
    } catch { continue; }
    if (!best) continue;
    const status = statusFor(now - best.m);
    if (!status) continue;
    const cwd = dir.replace(/^-/, "/").replaceAll("-", "/"); // lossy but display-only
    agents.push({
      id: `claude-${best.f.slice(0, 8)}`,
      name: "Fable", engine: "claude", status,
      cwd, lastEventAt: new Date(best.m).toISOString(),
    });
  }
}

// Codex sessions: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (cwd in meta line)
const csess = join(HOME, ".codex", "sessions");
function walk(p, depth = 0) {
  const out = [];
  try {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.isDirectory() && depth < 3) out.push(...walk(join(p, e.name), depth + 1));
      else if (e.name.startsWith("rollout-")) out.push(join(p, e.name));
    }
  } catch {}
  return out;
}
if (existsSync(csess)) {
  const files = walk(csess).map((f) => ({ f, m: statSync(f).mtimeMs }))
    .filter((x) => statusFor(now - x.m)).sort((a, b) => b.m - a.m).slice(0, 6);
  for (const { f, m } of files) {
    let cwd = HOME, sub = null;
    try {
      const first = readFileSync(f, "utf8").split("\n")[0];
      const meta = JSON.parse(first).payload || {};
      cwd = meta.cwd || HOME;
      sub = meta.agent_nickname || null;
    } catch {}
    agents.push({
      id: `codex-${f.slice(-14, -6)}`,
      name: sub || "Sol", engine: "codex", status: statusFor(now - m),
      cwd, lastEventAt: new Date(m).toISOString(),
    });
  }
}

// dedupe: one pawn per (engine,cwd), keep freshest
const seen = new Map();
for (const a of agents.sort((x, y) => new Date(y.lastEventAt) - new Date(x.lastEventAt))) {
  const k = `${a.engine}|${a.cwd}`;
  if (!seen.has(k)) seen.set(k, a);
}
const final = [...seen.values()].slice(0, 14);

// resolve island: match cwd against world.json entry paths (presentation-safe)
try {
  const world = JSON.parse(readFileSync(new URL("./public/world.json", import.meta.url)));
  for (const a of final) {
    let island = null, building = null;
    for (const e of world.entries) {
      if (a.cwd === e.path || a.cwd.startsWith(e.path + "/")) {
        island = e.path;
        for (const c of e.children || [])
          if (a.cwd === c.path || a.cwd.startsWith(c.path + "/")) building = c.path;
        break;
      }
    }
    a.islandPath = island; a.buildingPath = building;
  }
} catch {}

writeFileSync(new URL("./public/agents.json", import.meta.url),
  JSON.stringify({ generatedAt: new Date(now).toISOString(), agents: final }, null, 1));
console.log(`agents.json: ${final.length} agents — ` + final.map((a) => `${a.name}(${a.status}@${a.islandPath?.split("/").pop() || "~"})`).join(" · "));
