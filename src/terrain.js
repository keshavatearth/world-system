// Island heightfield geometry: smooth low-poly terrain with cliffs into the sea,
// biome vertex colors (sand → grass → forest floor → dirt → rock), flat-shaded.
import * as THREE from "three";
import { FIELD_RES, sampleField, makeNoise, hash } from "./layout.js";

const C = {
  sandLo: new THREE.Color("#eadfa8"), sandHi: new THREE.Color("#d9c98e"),
  grassLo: new THREE.Color("#7fc46c"), grassHi: new THREE.Color("#5da54f"),
  meadow: new THREE.Color("#9ad483"),
  dirt: new THREE.Color("#a97c50"),
  rockLo: new THREE.Color("#8d9099"), rockHi: new THREE.Color("#b7bcc4"),
  basaltLo: new THREE.Color("#3b3f47"), basaltHi: new THREE.Color("#575d68"),
  cliff: new THREE.Color("#7c6a55"),
  basaltCliff: new THREE.Color("#2e3138"),
};

export function buildIsland(lm) {
  const isDot = lm.entry.kind === "dot";
  const field = lm.field;
  const heightAt = lm.heightAt;
  const noise = makeNoise(hash(lm.entry.path + "biome"));

  // grid over the padded field, in world coords
  const w = field.w, h = field.h;
  const RES = 1 / FIELD_RES;
  const minWX = lm.cx + field.minX, minWZ = lm.cz + field.minZ;

  const positions = [];
  const colors = [];
  const uvs = [];

  const vert = (i, j) => {
    const wx = minWX + i * RES, wz = minWZ + j * RES;
    const { h: y } = heightAt(wx, wz);
    return [wx, y, wz];
  };
  const colorFor = (wx, wy, wz, slope) => {
    const n = noise(wx * 0.22, wz * 0.22);
    const out = new THREE.Color();
    if (isDot) {
      out.copy(C.basaltLo).lerp(C.basaltHi, Math.min(1, Math.max(0, wy / 1.6 + n * 0.3)));
      if (slope > 0.75) out.copy(C.basaltCliff);
      return out;
    }
    if (wy < 0.12) out.copy(C.sandLo).lerp(C.sandHi, 0.5 + n * 0.5);
    else if (wy < 0.5) out.copy(C.grassLo).lerp(C.meadow, 0.5 + n * 0.5);
    else if (wy < 2.1) out.copy(C.grassHi).lerp(C.grassLo, 0.5 + n * 0.5);
    else if (wy < 2.55) out.copy(C.dirt).lerp(C.grassHi, 0.35 + n * 0.3);
    else out.copy(C.rockLo).lerp(C.rockHi, 0.4 + n * 0.4);
    if (slope > 0.85 && wy > 0.2) out.lerp(C.cliff, 0.65); // cliff faces
    if (lm.recent) out.offsetHSL(0, 0.03, 0.03);
    if (lm.stale) out.offsetHSL(0, -0.12, -0.02);
    return out;
  };

  // two triangles per cell, non-indexed for flat shading
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      // skip cells entirely far outside the island (keeps vertex counts sane)
      const F = sampleField(field, field.minX + i * RES, field.minZ + j * RES);
      if (F < -1.2) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      const tris = [[a, c, b], [b, c, d]];
      for (const [p1, p2, p3] of tris) {
        const cx3 = (p1[0] + p2[0] + p3[0]) / 3, cy3 = (p1[1] + p2[1] + p3[1]) / 3, cz3 = (p1[2] + p2[2] + p3[2]) / 3;
        // face slope from normal
        const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
        const vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        const slope = 1 - Math.abs(ny / len);
        const col = colorFor(cx3, cy3, cz3, slope);
        for (const p of [p1, p2, p3]) {
          positions.push(p[0], p[1], p[2]);
          colors.push(col.r, col.g, col.b);
          uvs.push(p[0], p[2]); // world-space uv for detail texture
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// shared terrain material: vertex colors × world-space detail texture, flat shaded
export function terrainMaterial(detailMap) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    map: detailMap,
  });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv * 0.16);
        diffuseColor.rgb *= mix(vec3(1.0), sampledDiffuseColor.rgb, 0.45) * 1.25;
      #endif`
    );
  };
  return mat;
}
