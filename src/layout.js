// Deterministic filesystem → world layout, v3 "AAA":
// smooth per-island scalar fields (for heightfield terrain), global coast distance
// field (for water foam/shallows), biome props, docks, boat routes, bird anchors.
// Seeded by paths — geography is stable across rescans.

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// value-noise fbm, seeded
export function makeNoise(seed) {
  const r = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()].sort(() => r() - 0.5);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, z) => ((h & 1) ? -x : x) + ((h & 2) ? -z : z);
  function noise2(x, z) {
    const X = Math.floor(x) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); z -= Math.floor(z);
    const u = x * x * (3 - 2 * x), v = z * z * (3 - 2 * z);
    const a = grad(perm[X + perm[Z]], x, z);
    const b = grad(perm[X + 1 + perm[Z]], x - 1, z);
    const c = grad(perm[X + perm[Z + 1]], x, z - 1);
    const d = grad(perm[X + 1 + perm[Z + 1]], x - 1, z - 1);
    return a + u * (b - a) + v * (c + u * (d - c) - (a + u * (b - a)));
  }
  return function fbm(x, z, oct = 4) {
    let s = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { s += amp * noise2(x * f, z * f); amp *= 0.5; f *= 2.03; }
    return s;
  };
}

function makeBlob(nTiles, rand) {
  const key = (x, z) => `${x},${z}`;
  const tiles = new Map([[key(0, 0), { x: 0, z: 0 }]]);
  const frontier = [{ x: 0, z: 0 }];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (tiles.size < nTiles && frontier.length) {
    const i = Math.floor(rand() * frontier.length);
    const t = frontier[i];
    const open = dirs
      .map(([dx, dz]) => ({ x: t.x + dx, z: t.z + dz }))
      .filter((n) => !tiles.has(key(n.x, n.z)));
    if (!open.length) { frontier.splice(i, 1); continue; }
    const n = open[Math.floor(rand() * open.length)];
    tiles.set(key(n.x, n.z), n);
    frontier.push(n);
  }
  return tiles;
}

function edgeDistances(tileMap) {
  const key = (x, z) => `${x},${z}`;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const dist = new Map();
  const q = [];
  for (const t of tileMap.values()) {
    if (dirs.some(([dx, dz]) => !tileMap.has(key(t.x + dx, t.z + dz)))) {
      dist.set(key(t.x, t.z), 0); q.push(t);
    }
  }
  let head = 0;
  while (head < q.length) {
    const t = q[head++];
    const d = dist.get(key(t.x, t.z));
    for (const [dx, dz] of dirs) {
      const nk = key(t.x + dx, t.z + dz);
      if (tileMap.has(nk) && !dist.has(nk)) {
        dist.set(nk, d + 1);
        q.push({ x: t.x + dx, z: t.z + dz });
      }
    }
  }
  return dist;
}

// Per-island scalar field on a padded grid (RES samples per tile).
// F > 0 inside (interior distance), F < 0 outside (distance to coast, negated).
export const FIELD_RES = 2;
function buildField(tileMap, dists) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const t of tileMap.values()) {
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z);
  }
  const PAD = 3;
  minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;
  const w = (maxX - minX) * FIELD_RES + 1;
  const h = (maxZ - minZ) * FIELD_RES + 1;
  const f = new Float32Array(w * h);
  // seed: tile occupancy with interior distance, else -PAD (refined by blur)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = Math.round(minX + i / FIELD_RES);
      const z = Math.round(minZ + j / FIELD_RES);
      const d = dists.get(`${x},${z}`);
      f[j * w + i] = d !== undefined ? d + 0.75 : -1.6;
    }
  }
  // box blur passes to smooth coastline + interior
  const tmp = new Float32Array(f.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && ii < w && jj >= 0 && jj < h) { s += f[jj * w + ii]; n++; }
          }
        tmp[j * w + i] = s / n;
      }
    f.set(tmp);
  }
  return { f, w, h, minX, minZ };
}

export function sampleField(field, lx, lz) {
  const { f, w, h, minX, minZ } = field;
  const gx = (lx - minX) * FIELD_RES, gz = (lz - minZ) * FIELD_RES;
  const i0 = Math.max(0, Math.min(w - 2, Math.floor(gx)));
  const j0 = Math.max(0, Math.min(h - 2, Math.floor(gz)));
  const fx = Math.max(0, Math.min(1, gx - i0)), fz = Math.max(0, Math.min(1, gz - j0));
  const a = f[j0 * w + i0], b = f[j0 * w + i0 + 1];
  const c = f[(j0 + 1) * w + i0], d = f[(j0 + 1) * w + i0 + 1];
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}

// island height from field + noise; shared by terrain mesh + prop placement
export function makeHeightAt(lm) {
  const fbm = makeNoise(hash(lm.entry.path + "terrain"));
  const isDot = lm.entry.kind === "dot";
  const peak = isDot ? 1.4 : Math.min(2.3, 0.7 + lm.blobR * 0.085);
  return function heightAt(wx, wz) {
    const F = sampleField(lm.field, wx - lm.cx, wz - lm.cz);
    if (F <= 0) return { h: F * 1.6, F }; // below water, cliff skirt
    const base = Math.pow(Math.min(F, 8) / 8, 0.85) * peak;
    const n = fbm(wx * 0.09, wz * 0.09) * 1.4 * Math.min(1, F / 2.5);
    let hgt = Math.max(0.06, base + n * 0.55 + 0.22);
    // gentle terracing for the low-poly stylized read
    const step = 0.42;
    const k = hgt / step, fl = Math.floor(k), fr = k - fl;
    hgt = (fl + Math.min(1, fr * 1.6)) * step;
    return { h: hgt, F };
  };
}

export function buildLayout(world) {
  const DAY = 86400000;
  const now = Date.now();
  const entries = [...world.entries].sort((a, b) => b.weight - a.weight);
  const landmasses = [];
  const placed = [];
  const GAP = 5;

  function tilesFor(e) {
    const base = e.kind === "dot" ? 14 * Math.sqrt(Math.min(e.weight, 40)) : 36 * Math.sqrt(e.weight || 1);
    return Math.max(48, Math.min(1400, Math.round(base)));
  }
  function pack(e, blobR, startR) {
    const rnd = mulberry32(hash(e.path + "pos"));
    for (let r = startR; r < 500; r += 2.5) {
      for (let k = 0; k < 20; k++) {
        const a = rnd() * Math.PI * 2;
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        if (Math.hypot(cx, cz) < blobR + 8) continue;
        if (placed.every((p) => Math.hypot(cx - p.cx, cz - p.cz) > p.r + blobR + GAP))
          return { cx, cz };
      }
    }
    return { cx: 400, cz: 400 };
  }

  const nonDots = entries.filter((e) => e.kind !== "dot");
  const dots = entries.filter((e) => e.kind === "dot");

  for (const e of nonDots) {
    const n = tilesFor(e);
    const blobR = Math.sqrt(n / Math.PI) + 1.5;
    const { cx, cz } = pack(e, blobR, blobR + 10);
    placed.push({ cx, cz, r: blobR });
    const rand = mulberry32(hash(e.path));
    const tileMap = makeBlob(n, rand);
    const staleDays = (now - e.mtime) / DAY;
    landmasses.push({ entry: e, tileMap, cx: Math.round(cx), cz: Math.round(cz), blobR, rand,
      stale: staleDays > 30, recent: staleDays < 7 });
  }
  const worldR = Math.max(...placed.map((p) => Math.hypot(p.cx, p.cz) + p.r), 40);
  const dotHub = { x: Math.cos(-0.7) * (worldR + 26), z: Math.sin(-0.7) * (worldR + 26) };
  for (const e of dots) {
    const n = tilesFor(e);
    const blobR = Math.sqrt(n / Math.PI) + 1.5;
    const rnd = mulberry32(hash(e.path + "dot"));
    let cx = dotHub.x, cz = dotHub.z;
    for (let r = 0; r < 300; r += 2) {
      const a = rnd() * Math.PI * 2;
      cx = dotHub.x + Math.cos(a) * r; cz = dotHub.z + Math.sin(a) * r;
      if (placed.every((p) => Math.hypot(cx - p.cx, cz - p.cz) > p.r + blobR + 3.5)) break;
    }
    placed.push({ cx, cz, r: blobR });
    const rand = mulberry32(hash(e.path));
    const tileMap = makeBlob(n, rand);
    const staleDays = (now - e.mtime) / DAY;
    landmasses.push({ entry: e, tileMap, cx: Math.round(cx), cz: Math.round(cz), blobR, rand,
      stale: staleDays > 30, recent: staleDays < 7 });
  }

  // fields + heights
  for (const lm of landmasses) {
    lm.dists = edgeDistances(lm.tileMap);
    lm.field = buildField(lm.tileMap, lm.dists);
    lm.heightAt = makeHeightAt(lm);
  }

  // props, buildings, docks
  const buildings = [];
  const props = { pine: [], oak: [], palm: [], bush: [], grassTuft: [], flower: [], rock: [] };
  const docks = [];

  for (const lm of landmasses) {
    const isDot = lm.entry.kind === "dot";
    const rand = mulberry32(hash(lm.entry.path + "props"));
    const kids = lm.entry.children || [];
    const taken = [];

    // building spots: ring where field is 1.2..3.5 (gentle ground)
    const spots = [...lm.tileMap.values()]
      .map((t) => ({ x: t.x + lm.cx, z: t.z + lm.cz, d: lm.dists.get(`${t.x},${t.z}`) ?? 0 }))
      .filter((s) => s.d >= 1 && s.d <= 4)
      .sort(() => rand() - 0.5);
    for (const c of kids) {
      const spot = spots.find((s) => taken.every((q) => Math.hypot(s.x - q.x, s.z - q.z) >= 3.0));
      if (!spot) break;
      taken.push(spot);
      const { h } = lm.heightAt(spot.x, spot.z);
      const staleDays = (now - c.mtime) / DAY;
      buildings.push({
        child: c, parent: lm.entry, lm,
        x: spot.x, z: spot.z, y: Math.max(0.25, h),
        size: Math.max(0.8, Math.min(2.6, 0.6 + Math.log2(1 + (c.itemCount || 1)) * 0.34)),
        isHQ: !!c.isHQ, isRepo: !!c.git, dirty: !!(c.git && c.git.dirty),
        recent: staleDays < 7,
        seed: hash(c.path),
      });
    }

    // vegetation per tile with sub-tile scatter
    for (const t of lm.tileMap.values()) {
      const wx = t.x + lm.cx, wz = t.z + lm.cz;
      const d = lm.dists.get(`${t.x},${t.z}`) ?? 0;
      if (taken.some((q) => Math.hypot(wx - q.x, wz - q.z) < 2.2)) continue;
      const r0 = mulberry32(hash(`${wx}|${wz}|p`));
      const scatter = (cb, n) => {
        for (let k = 0; k < n; k++) {
          const ox = (r0() - 0.5) * 0.9, oz = (r0() - 0.5) * 0.9;
          const { h, F } = lm.heightAt(wx + ox, wz + oz);
          if (F > 0.25) cb(wx + ox, wz + oz, Math.max(0.1, h), r0);
        }
      };
      if (isDot) {
        if (r0() < 0.3) scatter((x, z, y, r) => props.rock.push({ x, z, y, s: 0.7 + r() * 1.6, seed: hash(`${x}${z}`) }), 2);
        continue;
      }
      const roll = r0();
      if (d === 0 && roll < 0.10) scatter((x, z, y, r) => props.palm.push({ x, z, y, s: 0.8 + r() * 0.7, seed: hash(`${x}${z}`) }), 1);
      else if (d >= 1 && roll < 0.22) {
        const pine = r0() < 0.65;
        scatter((x, z, y, r) => (pine ? props.pine : props.oak).push({ x, z, y, s: 0.7 + r() * 1.5, seed: hash(`${x}${z}`) }), 1 + Math.floor(r0() * 2));
      } else if (roll < 0.30) scatter((x, z, y, r) => props.bush.push({ x, z, y, s: 0.5 + r() * 0.8, seed: hash(`${x}${z}`) }), 1);
      else if (roll < 0.55) scatter((x, z, y, r) => props.grassTuft.push({ x, z, y, s: 0.6 + r() * 0.8, seed: hash(`${x}${z}`) }), 2);
      else if (roll < 0.62) scatter((x, z, y, r) => props.flower.push({ x, z, y, s: 0.7 + r() * 0.6, seed: hash(`${x}${z}`) }), 1);
      if (d >= 3 && r0() > 0.965) scatter((x, z, y, r) => props.rock.push({ x, z, y, s: 0.6 + r() * 1.4, seed: hash(`${x}${z}`) }), 1);
    }

    // one dock per major/area: coastal tile facing away from world center
    if (["major", "area"].includes(lm.entry.kind)) {
      const coast = [...lm.tileMap.values()]
        .filter((t) => (lm.dists.get(`${t.x},${t.z}`) ?? 0) === 0)
        .map((t) => ({ x: t.x + lm.cx, z: t.z + lm.cz }));
      if (coast.length) {
        const away = coast.reduce((best, c) =>
          Math.hypot(c.x, c.z) > Math.hypot(best.x, best.z) ? c : best);
        const dir = Math.atan2(away.z - lm.cz, away.x - lm.cx);
        docks.push({ x: away.x, z: away.z, dir, lm });
      }
    }
  }

  // global coast distance field (for water foam/shallows) via chamfer transform
  const B = 6;
  let bMinX = 1e9, bMaxX = -1e9, bMinZ = 1e9, bMaxZ = -1e9;
  for (const lm of landmasses)
    for (const t of lm.tileMap.values()) {
      bMinX = Math.min(bMinX, t.x + lm.cx); bMaxX = Math.max(bMaxX, t.x + lm.cx);
      bMinZ = Math.min(bMinZ, t.z + lm.cz); bMaxZ = Math.max(bMaxZ, t.z + lm.cz);
    }
  bMinX -= B; bMaxX += B; bMinZ -= B; bMaxZ += B;
  const CW = 512, CH = 512;
  const sx = (bMaxX - bMinX) / CW, sz = (bMaxZ - bMinZ) / CH;
  const occ = new Float32Array(CW * CH).fill(1e6);
  for (const lm of landmasses)
    for (const t of lm.tileMap.values()) {
      const gx = Math.round((t.x + lm.cx - bMinX) / sx), gz = Math.round((t.z + lm.cz - bMinZ) / sz);
      if (gx >= 0 && gx < CW && gz >= 0 && gz < CH) occ[gz * CW + gx] = 0;
    }
  const cell = (sx + sz) / 2;
  for (let j = 0; j < CH; j++)
    for (let i = 0; i < CW; i++) {
      const v = occ[j * CW + i];
      if (i > 0) occ[j * CW + i] = Math.min(occ[j * CW + i], occ[j * CW + i - 1] + cell);
      if (j > 0) occ[j * CW + i] = Math.min(occ[j * CW + i], occ[(j - 1) * CW + i] + cell);
      if (i > 0 && j > 0) occ[j * CW + i] = Math.min(occ[j * CW + i], occ[(j - 1) * CW + i - 1] + cell * 1.41);
    }
  for (let j = CH - 1; j >= 0; j--)
    for (let i = CW - 1; i >= 0; i--) {
      if (i < CW - 1) occ[j * CW + i] = Math.min(occ[j * CW + i], occ[j * CW + i + 1] + cell);
      if (j < CH - 1) occ[j * CW + i] = Math.min(occ[j * CW + i], occ[(j + 1) * CW + i] + cell);
      if (i < CW - 1 && j < CH - 1) occ[j * CW + i] = Math.min(occ[j * CW + i], occ[(j + 1) * CW + i + 1] + cell * 1.41);
    }
  const coastField = { data: occ, w: CW, h: CH, minX: bMinX, minZ: bMinZ, maxX: bMaxX, maxZ: bMaxZ };

  // boat routes: rings around world center threading the gaps
  const routes = [];
  const routeRadii = [worldR * 0.45, worldR * 0.75, worldR * 1.05];
  routeRadii.forEach((r, i) => routes.push({ r, speed: 0.02 + i * 0.008, phase: i * 2.1, count: 2 + i }));

  return { landmasses, buildings, props, docks, coastField, routes, worldR, dotHub };
}
