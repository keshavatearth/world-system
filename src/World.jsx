import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text, useTexture, Clouds, Cloud } from "@react-three/drei";
import * as THREE from "three";
import { buildIsland, terrainMaterial } from "./terrain.js";
import { mulberry32 } from "./layout.js";
import { InkSelection } from "./ui/InkSelection.jsx";

/* ------------------------------ shared uniforms ------------------------------ */
export const worldU = {
  time: { value: 0 },
  night: { value: 0 }, // 0 = day … 1 = night
  sunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
};

function windMaterial(params, sway = 0.12) {
  const mat = new THREE.MeshStandardMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldU.time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #else
            vec4 wp = modelMatrix * vec4(transformed, 1.0);
          #endif
          float bendW = smoothstep(0.15, 1.4, transformed.y);
          float sw = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.27) * ${sway.toFixed(3)};
          transformed.x += sw * bendW;
          transformed.z += cos(uTime * 1.3 + wp.x * 0.21) * ${(sway * 0.6).toFixed(3)} * bendW;
        }`
      );
  };
  return mat;
}

/* --------------------------------- terrain --------------------------------- */
function Islands({ landmasses, detailMap, onHover, onSelect }) {
  const mat = useMemo(() => terrainMaterial(detailMap), [detailMap]);
  const geos = useMemo(() => landmasses.map((lm) => buildIsland(lm)), [landmasses]);
  return (
    <group>
      {landmasses.map((lm, i) => (
        <mesh
          key={lm.entry.path}
          geometry={geos[i]}
          material={mat}
          receiveShadow
          castShadow
          onPointerMove={(e) => { e.stopPropagation(); onHover({ kind: "landmass", data: lm.entry, lm }); }}
          onPointerOut={() => onHover(null)}
          onClick={(e) => { e.stopPropagation(); onSelect({ kind: "landmass", data: lm.entry, lm }); }}
        />
      ))}
    </group>
  );
}

/* ---------------------------------- ocean ---------------------------------- */
function Ocean({ coastField, normalMap, onHover, onSelect }) {
  const matRef = useRef();
  const coastTex = useMemo(() => {
    const { data, w, h } = coastField;
    const bytes = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) bytes[i] = Math.min(255, (data[i] / 40) * 255);
    const t = new THREE.DataTexture(bytes, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }, [coastField]);

  const uniforms = useMemo(() => ({
    uTime: worldU.time,
    uNight: worldU.night,
    uSunDir: worldU.sunDir,
    uCoast: { value: coastTex },
    uBounds: { value: new THREE.Vector4(coastField.minX, coastField.minZ, coastField.maxX - coastField.minX, coastField.maxZ - coastField.minZ) },
    uNormal: { value: normalMap },
  }), [coastTex, coastField, normalMap]);

  useFrame((_, dt) => { worldU.time.value += dt; });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}
      onPointerMove={(e) => { e.stopPropagation(); onHover(null); }}
      onClick={(e) => { e.stopPropagation(); onSelect(null); }}>
      <planeGeometry args={[1600, 1600, 220, 220]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          uniform float uTime;
          varying vec3 vW;
          varying float vWave;
          void main() {
            vec3 p = position;
            vec4 w = modelMatrix * vec4(p, 1.0);
            float wv = sin(w.x * 0.18 + uTime * 0.9) * 0.10
                     + sin(w.z * 0.14 - uTime * 0.7) * 0.08
                     + sin((w.x + w.z) * 0.09 + uTime * 0.5) * 0.06;
            w.y += wv;
            vWave = wv;
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform float uTime;
          uniform float uNight;
          uniform vec3 uSunDir;
          uniform sampler2D uCoast;
          uniform sampler2D uNormal;
          uniform vec4 uBounds;
          varying vec3 vW;
          varying float vWave;
          void main() {
            vec2 cuv = (vW.xz - uBounds.xy) / uBounds.zw;
            float dist = texture2D(uCoast, cuv).r * 40.0;
            if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) dist = 40.0;

            vec3 n1 = texture2D(uNormal, vW.xz * 0.035 + vec2(uTime * 0.015, uTime * 0.010)).rgb;
            vec3 n2 = texture2D(uNormal, vW.xz * 0.070 - vec2(uTime * 0.011, uTime * 0.017)).rgb;
            vec3 nrm = normalize(vec3(0.0, 1.0, 0.0) + (n1 + n2 - 1.0) * 0.55);

            vec3 deepDay = vec3(0.075, 0.35, 0.52);
            vec3 shallowDay = vec3(0.28, 0.72, 0.78);
            vec3 deepNight = vec3(0.02, 0.07, 0.16);
            vec3 shallowNight = vec3(0.05, 0.18, 0.28);
            vec3 deep = mix(deepDay, deepNight, uNight);
            vec3 shallow = mix(shallowDay, shallowNight, uNight);

            float shallowMix = smoothstep(4.5, 0.0, dist);
            vec3 col = mix(deep, shallow, shallowMix);

            // shoreline foam: animated edge + secondary lapping band
            float fn = texture2D(uNormal, vW.xz * 0.09 + vec2(uTime * 0.03, -uTime * 0.02)).g;
            float band1 = smoothstep(0.6 + fn * 0.35, 0.02, dist);
            float band2 = smoothstep(0.18, 0.0, abs(dist - (2.6 + sin(uTime * 0.8) * 0.45))) * 0.22;
            float foam = clamp(band1 + band2, 0.0, 1.0);
            // open-sea whitecaps on wave crests
            float caps = smoothstep(0.78, 0.92, fn) * smoothstep(0.05, 0.16, vWave) * 0.5;
            col = mix(col, vec3(0.94, 0.98, 1.0), clamp(foam + caps, 0.0, 0.5) * (1.0 - uNight * 0.55));

            // sun specular
            vec3 viewDir = normalize(cameraPosition - vW);
            vec3 hf = normalize(viewDir + normalize(uSunDir));
            float spec = pow(max(dot(nrm, hf), 0.0), 90.0) * (1.0 - uNight * 0.4);
            col += spec * vec3(1.0, 0.95, 0.8) * 0.7;

            // day/night ambient shading
            float lam = 0.65 + 0.35 * max(dot(nrm, normalize(uSunDir)), 0.0);
            col *= lam;

            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `}
      />
    </mesh>
  );
}

/* ------------------------------- vegetation ------------------------------- */
function Instanced({ items, geo, mat, ySort, castShadow = true, yOffset = 0, scaleY = 1 }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m || !items.length) return;
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const E = new THREE.Euler();
    items.forEach((t, i) => {
      E.set(0, (t.seed % 628) / 100, 0);
      Q.setFromEuler(E);
      M.compose(
        new THREE.Vector3(t.x, t.y + yOffset * t.s, t.z),
        Q,
        new THREE.Vector3(t.s, t.s * scaleY, t.s)
      );
      m.setMatrixAt(i, M);
      if (t.color && m.instanceColor !== undefined) m.setColorAt(i, t.color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return (
    <instancedMesh ref={ref} args={[geo, mat, items.length]} castShadow={castShadow} receiveShadow raycast={() => null} />
  );
}

function Vegetation({ props }) {
  const geos = useMemo(() => ({
    trunk: new THREE.CylinderGeometry(0.05, 0.09, 0.55, 5),
    pineA: new THREE.ConeGeometry(0.36, 0.7, 6),
    pineB: new THREE.ConeGeometry(0.26, 0.55, 6),
    oak: new THREE.IcosahedronGeometry(0.38, 0),
    palmTrunk: new THREE.CylinderGeometry(0.045, 0.08, 1.1, 5),
    frond: new THREE.BoxGeometry(0.9, 0.035, 0.18),
    bush: new THREE.IcosahedronGeometry(0.3, 0),
    tuft: new THREE.ConeGeometry(0.05, 0.42, 4),
    petal: new THREE.IcosahedronGeometry(0.07, 0),
    stem: new THREE.CylinderGeometry(0.012, 0.012, 0.24, 3),
    rock: new THREE.DodecahedronGeometry(0.26, 0),
  }), []);
  const mats = useMemo(() => ({
    trunk: new THREE.MeshStandardMaterial({ color: "#7a4f2e", flatShading: true }),
    pine: windMaterial({ color: "#3f8a3f", flatShading: true }, 0.07),
    pineDark: windMaterial({ color: "#2f6e33", flatShading: true }, 0.07),
    oak: windMaterial({ color: "#5aa050", flatShading: true }, 0.09),
    palmTrunk: new THREE.MeshStandardMaterial({ color: "#9a6a3e", flatShading: true }),
    frond: windMaterial({ color: "#41a066", flatShading: true }, 0.2),
    bush: windMaterial({ color: "#4d9145", flatShading: true }, 0.06),
    tuft: windMaterial({ color: "#79c46a", flatShading: true }, 0.16),
    flower: new THREE.MeshStandardMaterial({ flatShading: true, color: "#ffffff" }),
    stem: new THREE.MeshStandardMaterial({ color: "#4d9145" }),
    rock: new THREE.MeshStandardMaterial({ color: "#828a94", flatShading: true, roughness: 0.95 }),
  }), []);

  const flowerColors = useMemo(() => {
    const cs = ["#ff8fb2", "#ffd166", "#ff6b6b", "#c9a0ff", "#fff3ae"].map((c) => new THREE.Color(c));
    return props.flower.map((f) => ({ ...f, color: cs[f.seed % cs.length] }));
  }, [props.flower]);

  // palms: trunk + 4 fronds as separate instanced sets sharing placements
  const fronds = useMemo(() => {
    const out = [];
    for (const p of props.palm)
      for (let k = 0; k < 4; k++)
        out.push({ ...p, seed: p.seed + k * 157, y: p.y + 1.05 * p.s });
    return out;
  }, [props.palm]);

  return (
    <group>
      <Instanced items={props.pine} geo={geos.trunk} mat={mats.trunk} yOffset={0.25} />
      <Instanced items={props.pine} geo={geos.pineA} mat={mats.pine} yOffset={0.72} />
      <Instanced items={props.pine} geo={geos.pineB} mat={mats.pineDark} yOffset={1.15} />
      <Instanced items={props.oak} geo={geos.trunk} mat={mats.trunk} yOffset={0.25} />
      <Instanced items={props.oak} geo={geos.oak} mat={mats.oak} yOffset={0.75} />
      <Instanced items={props.palm} geo={geos.palmTrunk} mat={mats.palmTrunk} yOffset={0.5} />
      <Instanced items={fronds} geo={geos.frond} mat={mats.frond} castShadow={false} />
      <Instanced items={props.bush} geo={geos.bush} mat={mats.bush} yOffset={0.2} castShadow={false} />
      <Instanced items={props.grassTuft} geo={geos.tuft} mat={mats.tuft} yOffset={0.2} castShadow={false} />
      <Instanced items={props.flower} geo={geos.stem} mat={mats.stem} yOffset={0.1} castShadow={false} />
      <Instanced items={flowerColors} geo={geos.petal} mat={mats.flower} yOffset={0.26} castShadow={false} />
      <Instanced items={props.rock} geo={geos.rock} mat={mats.rock} yOffset={0.08} scaleY={0.8} />
    </group>
  );
}

/* -------------------------------- buildings -------------------------------- */
const windowMat = new THREE.MeshStandardMaterial({ color: "#3a2c1c", emissive: "#ffb545", emissiveIntensity: 0 });

function House({ b, onHover, onSelect }) {
  const rnd = mulberry32(b.seed);
  const bodyCol = ["#e8d3b0", "#dfc49a", "#d9b98e", "#e5cfa8"][b.seed % 4];
  const roofCol = ["#b0522f", "#9e4a2c", "#8a5138", "#a34a33"][(b.seed >> 2) % 4];
  const s = b.size;
  const rotY = (b.seed % 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.4;
  return (
    <group position={[b.x, b.y, b.z]} rotation={[0, rotY, 0]}
      onPointerMove={(e) => { e.stopPropagation(); onHover({ kind: "building", data: b.child, parent: b.parent }); }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onSelect({ kind: "building", data: b.child, parent: b.parent }); }}>
      <mesh position={[0, 0.4 * s, 0]} castShadow>
        <boxGeometry args={[0.9 * s, 0.8 * s, 0.7 * s]} />
        <meshStandardMaterial color={bodyCol} flatShading
          emissive={b.recent ? "#2e5b28" : "#000"} emissiveIntensity={b.recent ? 0.25 : 0} />
      </mesh>
      {/* gabled roof: stretched 4-cone reads as a prism at this size */}
      <mesh position={[0, 0.93 * s, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1.25, 1, 0.95]} castShadow>
        <coneGeometry args={[0.62 * s, 0.5 * s, 4]} />
        <meshStandardMaterial color={roofCol} flatShading />
      </mesh>
      <mesh position={[0.25 * s, 1.1 * s, 0.1 * s]} castShadow>
        <boxGeometry args={[0.1 * s, 0.3 * s, 0.1 * s]} />
        <meshStandardMaterial color="#8d8d8d" />
      </mesh>
      <mesh position={[0, 0.32 * s, 0.36 * s]}>
        <boxGeometry args={[0.16 * s, 0.3 * s, 0.02]} />
        <meshStandardMaterial color="#5e422a" />
      </mesh>
      {[-0.25, 0.25].map((ox, i) => (
        <mesh key={i} position={[ox * s, 0.5 * s, 0.357 * s]} material={windowMat}>
          <boxGeometry args={[0.14 * s, 0.14 * s, 0.01]} />
        </mesh>
      ))}
    </group>
  );
}

function Tower({ b, onHover, onSelect }) {
  const s = b.size;
  const col = b.dirty ? "#b7a696" : "#c4cdd8";
  return (
    <group position={[b.x, b.y, b.z]}
      onPointerMove={(e) => { e.stopPropagation(); onHover({ kind: "building", data: b.child, parent: b.parent }); }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onSelect({ kind: "building", data: b.child, parent: b.parent }); }}>
      <mesh position={[0, 0.7 * s, 0]} castShadow>
        <cylinderGeometry args={[0.32 * s, 0.4 * s, 1.4 * s, 7]} />
        <meshStandardMaterial color={col} flatShading
          emissive={b.recent ? "#2e5b28" : "#000"} emissiveIntensity={b.recent ? 0.25 : 0} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <mesh key={k} position={[Math.cos((k / 6) * Math.PI * 2) * 0.32 * s, 1.48 * s, Math.sin((k / 6) * Math.PI * 2) * 0.32 * s]} castShadow>
          <boxGeometry args={[0.12 * s, 0.14 * s, 0.12 * s]} />
          <meshStandardMaterial color={col} flatShading />
        </mesh>
      ))}
      <mesh position={[0, 0.75 * s, 0.36 * s]} material={windowMat}>
        <boxGeometry args={[0.1 * s, 0.18 * s, 0.02]} />
      </mesh>
      <group position={[0, 1.55 * s, 0]}>
        <mesh position={[0, 0.35 * s, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.8 * s]} />
          <meshStandardMaterial color="#4b4b4b" />
        </mesh>
        <mesh position={[0.16 * s, 0.58 * s, 0]}>
          <boxGeometry args={[0.3 * s, 0.2 * s, 0.02]} />
          <meshStandardMaterial color={b.dirty ? "#e0563f" : "#f2f0e9"}
            emissive={b.dirty ? "#8a2413" : "#000"} emissiveIntensity={b.dirty ? 0.45 : 0} />
        </mesh>
      </group>
    </group>
  );
}

function Castle({ b, onHover, onSelect }) {
  const s = b.size * 1.25;
  const crystal = useRef();
  useFrame((st) => {
    if (crystal.current) {
      crystal.current.rotation.y = st.clock.elapsedTime * 0.8;
      crystal.current.position.y = 2.55 * s + Math.sin(st.clock.elapsedTime * 1.4) * 0.12;
    }
  });
  const stone = "#d8c9a8", trim = "#a87d1e";
  return (
    <group position={[b.x, b.y, b.z]}
      onPointerMove={(e) => { e.stopPropagation(); onHover({ kind: "building", data: b.child, parent: b.parent }); }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onSelect({ kind: "building", data: b.child, parent: b.parent }); }}>
      <mesh position={[0, 0.45 * s, 0]} castShadow>
        <boxGeometry args={[1.7 * s, 0.9 * s, 1.7 * s]} />
        <meshStandardMaterial color={stone} flatShading />
      </mesh>
      <mesh position={[0, 1.15 * s, 0]} castShadow>
        <boxGeometry args={[1.1 * s, 0.9 * s, 1.1 * s]} />
        <meshStandardMaterial color={stone} flatShading emissive="#403008" emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0, 1.85 * s, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[0.85 * s, 0.7 * s, 4]} />
        <meshStandardMaterial color={trim} flatShading />
      </mesh>
      {[[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]].map(([ox, oz], k) => (
        <group key={k} position={[ox * s, 0, oz * s]}>
          <mesh position={[0, 0.8 * s, 0]} castShadow>
            <cylinderGeometry args={[0.22 * s, 0.28 * s, 1.6 * s, 6]} />
            <meshStandardMaterial color={stone} flatShading />
          </mesh>
          <mesh position={[0, 1.75 * s, 0]} castShadow>
            <coneGeometry args={[0.3 * s, 0.5 * s, 6]} />
            <meshStandardMaterial color="#7c3a86" flatShading />
          </mesh>
        </group>
      ))}
      <mesh ref={crystal} position={[0, 2.55 * s, 0]}>
        <octahedronGeometry args={[0.28 * s, 0]} />
        <meshStandardMaterial color="#ffd45e" emissive="#ffae00" emissiveIntensity={1.6} />
      </mesh>
      {[-0.3, 0.3].map((ox, i) => (
        <mesh key={i} position={[ox * s, 0.5 * s, 0.86 * s]} material={windowMat}>
          <boxGeometry args={[0.18 * s, 0.24 * s, 0.02]} />
        </mesh>
      ))}
    </group>
  );
}

function Buildings({ buildings, onHover, onSelect }) {
  return (
    <group>
      {buildings.map((b) =>
        b.isHQ ? <Castle key={b.child.path} b={b} onHover={onHover} onSelect={onSelect} />
          : b.isRepo ? <Tower key={b.child.path} b={b} onHover={onHover} onSelect={onSelect} />
          : <House key={b.child.path} b={b} onHover={onHover} onSelect={onSelect} />
      )}
    </group>
  );
}

/* ------------------------------ docks & boats ------------------------------ */
function Docks({ docks }) {
  return (
    <group>
      {docks.map((d, i) => (
        <group key={i} position={[d.x, 0.18, d.z]} rotation={[0, -d.dir, 0]}>
          {[0.8, 1.6, 2.4].map((off, k) => (
            <mesh key={k} position={[off, 0, 0]} castShadow>
              <boxGeometry args={[0.75, 0.08, 0.9]} />
              <meshStandardMaterial color="#8a6a45" flatShading />
            </mesh>
          ))}
          {[0.5, 1.9, 2.8].map((off, k) => (
            <group key={`p${k}`}>
              <mesh position={[off, -0.25, 0.38]}>
                <cylinderGeometry args={[0.05, 0.05, 0.6, 5]} />
                <meshStandardMaterial color="#6d5236" />
              </mesh>
              <mesh position={[off, -0.25, -0.38]}>
                <cylinderGeometry args={[0.05, 0.05, 0.6, 5]} />
                <meshStandardMaterial color="#6d5236" />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

function Boat({ route, index }) {
  const ref = useRef();
  const phase = route.phase + (index / route.count) * Math.PI * 2;
  useFrame((st) => {
    const t = st.clock.elapsedTime * route.speed + phase;
    const x = Math.cos(t) * route.r, z = Math.sin(t) * route.r;
    const g = ref.current;
    if (!g) return;
    g.position.set(x, 0.05 + Math.sin(st.clock.elapsedTime * 1.3 + phase) * 0.05, z);
    g.rotation.y = -t - Math.PI / 2;
    g.rotation.z = Math.sin(st.clock.elapsedTime * 1.1 + phase) * 0.05;
  });
  const sailCol = ["#f2ede0", "#ffd9a0", "#cfe6f2", "#f4c7c3"][index % 4];
  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[1.3, 0.3, 0.55]} />
        <meshStandardMaterial color="#7a4a2c" flatShading />
      </mesh>
      <mesh position={[0.3, 0.22, 0]}>
        <boxGeometry args={[0.5, 0.14, 0.4]} />
        <meshStandardMaterial color="#94613c" flatShading />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.1, 4]} />
        <meshStandardMaterial color="#5c4028" />
      </mesh>
      <mesh position={[-0.02, 0.8, 0]} rotation={[0, 0, 0]}>
        <coneGeometry args={[0.42, 0.85, 3]} />
        <meshStandardMaterial color={sailCol} flatShading side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
function Boats({ routes }) {
  return (
    <group>
      {routes.flatMap((r, ri) =>
        Array.from({ length: r.count }, (_, i) => <Boat key={`${ri}-${i}`} route={r} index={i} />)
      )}
    </group>
  );
}

/* ---------------------------------- birds ---------------------------------- */
function Flock({ anchor, seed }) {
  const g = useRef();
  const rnd = mulberry32(seed);
  const birds = useMemo(() => Array.from({ length: 5 }, () => ({
    r: 3 + rnd() * 4, h: 7 + rnd() * 4, ph: rnd() * Math.PI * 2, sp: 0.25 + rnd() * 0.2,
  })), []);
  useFrame((st) => {
    if (!g.current) return;
    const t = st.clock.elapsedTime;
    g.current.children.forEach((bird, i) => {
      const b = birds[i];
      const a = t * b.sp + b.ph;
      bird.position.set(anchor[0] + Math.cos(a) * b.r, b.h + Math.sin(t * 1.7 + b.ph) * 0.4, anchor[1] + Math.sin(a) * b.r);
      bird.rotation.y = -a;
      const flap = Math.sin(t * 9 + b.ph) * 0.55;
      bird.children[0].rotation.z = flap;
      bird.children[1].rotation.z = -flap;
    });
  });
  return (
    <group ref={g}>
      {birds.map((_, i) => (
        <group key={i} scale={0.5}>
          <mesh position={[0, 0, -0.22]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.05, 0.02, 0.45]} />
            <meshStandardMaterial color="#2c3540" />
          </mesh>
          <mesh position={[0, 0, 0.22]}>
            <boxGeometry args={[0.05, 0.02, 0.45]} />
            <meshStandardMaterial color="#2c3540" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ----------------------------- fog-of-war clouds ---------------------------- */
function FogOfWar({ landmasses }) {
  const stale = landmasses.filter((l) => l.stale);
  return (
    <Clouds material={THREE.MeshLambertMaterial} limit={stale.length * 3 + 6}>
      {stale.map((l, i) => (
        <Cloud key={i} seed={i + 1}
          position={[l.cx, 6.5 + (i % 3) * 0.7, l.cz]}
          bounds={[l.blobR * 0.9, 1.2, l.blobR * 0.7]}
          segments={Math.min(14, 5 + Math.round(l.blobR))}
          volume={Math.max(4, l.blobR * 0.85)}
          color="#eef3f6" opacity={0.5} speed={0.08} fade={12}
        />
      ))}
    </Clouds>
  );
}

/* -------------------------------- focus ring ------------------------------- */
function FocusRing({ target }) {
  const ref = useRef();
  useFrame((st) => {
    if (!ref.current || !target) return;
    const t = st.clock.elapsedTime;
    const s = 1 + Math.sin(t * 2.4) * 0.05;
    ref.current.scale.set(s, s, s);
    ref.current.material.opacity = 0.45 + Math.sin(t * 2.4) * 0.15;
  });
  if (!target) return null;
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[target.cx, 0.35, target.cz]} raycast={() => null}>
      <ringGeometry args={[target.blobR + 1.2, target.blobR + 1.9, 48]} />
      <meshBasicMaterial color="#ffd45e" transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
}


/* ------------------------------ live agent pawns ---------------------------- */
const ENGINE_COLORS = { claude: "#d9a33c", codex: "#4fa8aa", factory: "#8a6fd1" };
const STATUS_COLORS = { active: "#4caf6d", waiting: "#d9a33c", idle: "#8a94a0", blocked: "#e0563f", done: "#6fd393" };

function AgentPawn({ agent, anchor, seed, onHover, onSelect }) {
  const g = useRef();
  const rnd = useMemo(() => mulberry32(seed), [seed]);
  const waypoints = useMemo(() => Array.from({ length: 3 }, () => ({
    x: anchor.x + (rnd() - 0.5) * 4.5, z: anchor.z + (rnd() - 0.5) * 4.5,
  })), [anchor, rnd]);
  const walk = useRef({ from: 0, to: 1, t: rnd() });
  useFrame((st, dt) => {
    const gr = g.current; if (!gr) return;
    const wlk = walk.current;
    const speed = agent.status === "active" ? 0.12 : 0.03;
    wlk.t += dt * speed;
    if (wlk.t >= 1) { wlk.t = 0; wlk.from = wlk.to; wlk.to = (wlk.to + 1 + Math.floor(rnd() * 2)) % waypoints.length; }
    const a = waypoints[wlk.from], b = waypoints[wlk.to];
    const e = wlk.t * wlk.t * (3 - 2 * wlk.t);
    gr.position.x = a.x + (b.x - a.x) * e;
    gr.position.z = a.z + (b.z - a.z) * e;
    gr.position.y = anchor.y + Math.abs(Math.sin(st.clock.elapsedTime * 6)) * (agent.status === "active" ? 0.06 : 0);
    gr.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  });
  const col = ENGINE_COLORS[agent.engine] || "#cccccc";
  const scol = STATUS_COLORS[agent.status] || "#8a94a0";
  const sel = () => onSelect({ kind: "agent", data: {
    name: `${agent.name} · ${agent.engine}`, path: agent.cwd, kind: "agent",
    mtime: new Date(agent.lastEventAt).getTime(), itemCount: null,
  }});
  return (
    <group ref={g} position={[anchor.x, anchor.y, anchor.z]}
      onPointerMove={(e) => { e.stopPropagation(); onHover({ kind: "agent", data: { name: agent.name, itemCount: null, mtime: new Date(agent.lastEventAt).getTime() } }); }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); sel(); }}>
      <mesh position={[0, 0.34, 0]} castShadow>
        <coneGeometry args={[0.22, 0.62, 7]} />
        <meshStandardMaterial color={col} flatShading emissive={col} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 0.74, 0]} castShadow>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color="#f2e8d8" flatShading />
      </mesh>
      {/* presence beacon */}
      <mesh position={[0, 1.25, 0]}>
        <octahedronGeometry args={[0.09, 0]} />
        <meshStandardMaterial color={scol} emissive={scol} emissiveIntensity={1.6} />
      </mesh>
      <Billboard position={[0, 1.75, 0]}>
        <Text fontSize={0.42} color="#13242d" outlineWidth={0.045} outlineColor="#eaf6fa" raycast={() => null}>
          {`${agent.name} · ${agent.status.toUpperCase()}`}
        </Text>
      </Billboard>
    </group>
  );
}

function AgentPawns({ agents, layout, onHover, onSelect }) {
  const anchors = useMemo(() => {
    return agents.map((a, i) => {
      let x = 0, z = 0, lm = null;
      if (a.buildingPath) {
        const b = layout.buildings.find((b) => b.child.path === a.buildingPath);
        if (b) { x = b.x + 1.2; z = b.z + 1.2; lm = b.lm; }
      }
      if (!lm && a.islandPath) {
        lm = layout.landmasses.find((l) => l.entry.path === a.islandPath) || null;
        if (lm) { x = lm.cx + 2; z = lm.cz + 2; }
      }
      if (!lm) { x = 2.5 + i * 1.6; z = 2.5; } // homeless agents camp near the origin monument
      const y = lm ? Math.max(0.3, lm.heightAt(x, z).h) : 0.3;
      return { x, y, z };
    });
  }, [agents, layout]);
  return (
    <group>
      {agents.map((a, i) => (
        <AgentPawn key={a.id} agent={a} anchor={anchors[i]} seed={i * 7919 + 13} onHover={onHover} onSelect={onSelect} />
      ))}
    </group>
  );
}

/* ---------------------------------- world ---------------------------------- */
export default function World({ layout, agents = [], onHover, onSelect, selectedLm, night }) {
  const { landmasses, buildings, props, docks, coastField, routes, worldR } = layout;
  const tex = useTexture({ grass: "/textures/grass.jpg", water: "/textures/waternormals.jpg" });
  useMemo(() => {
    tex.grass.wrapS = tex.grass.wrapT = THREE.RepeatWrapping;
    tex.grass.colorSpace = THREE.SRGBColorSpace;
    tex.water.wrapS = tex.water.wrapT = THREE.RepeatWrapping;
  }, [tex]);

  // drive shared night uniform + window glow
  useFrame(() => {
    worldU.night.value = night;
    windowMat.emissiveIntensity = night * 1.6;
  });

  const flockAnchors = useMemo(() => {
    const majors = landmasses.filter((l) => ["major", "area"].includes(l.entry.kind)).slice(0, 4);
    return majors.map((l) => [l.cx, l.cz]);
  }, [landmasses]);

  return (
    <group>
      <Ocean coastField={coastField} normalMap={tex.water} onHover={onHover} onSelect={onSelect} />
      <Islands landmasses={landmasses} detailMap={tex.grass} onHover={onHover} onSelect={onSelect} />
      <Vegetation props={props} />
      <Buildings buildings={buildings} onHover={onHover} onSelect={onSelect} />
      <Docks docks={docks} />
      <Boats routes={routes} />
      {flockAnchors.map((a, i) => <Flock key={i} anchor={a} seed={i * 999 + 7} />)}
      {!new URLSearchParams(location.search).has("noclouds") && <FogOfWar landmasses={landmasses} />}
      {selectedLm && (
        <InkSelection
          position={[selectedLm.cx, 0.36, selectedLm.cz]}
          footprint={selectedLm.blobR * 2.2}
          rotation={(selectedLm.seed % 17) * 0.08}
          selected
        />
      )}
      <AgentPawns agents={agents} layout={layout} onHover={onHover} onSelect={onSelect} />

      {/* home monument */}
      <group>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.55, 0.8, 1.0, 6]} />
          <meshStandardMaterial color="#e6dfcf" flatShading />
        </mesh>
        <HomeCrystal />
      </group>

      {/* labels */}
      {landmasses
        .filter((l) => ["major", "area"].includes(l.entry.kind) || l.entry.weight > 40)
        .map((l, i) => (
          <Billboard key={`lb${i}`} position={[l.cx, 5.2 + l.blobR * 0.14, l.cz]}>
            <Text
              fontSize={l.entry.kind === "major" ? 2.6 : 1.5}
              color="#13242d" outlineWidth={0.09} outlineColor="#eaf6fa"
              raycast={() => null}>
              {l.entry.name}
            </Text>
          </Billboard>
        ))}
    </group>
  );
}

function HomeCrystal() {
  const ref = useRef();
  useFrame((st) => {
    if (!ref.current) return;
    ref.current.rotation.y = st.clock.elapsedTime * 0.6;
    ref.current.position.y = 1.75 + Math.sin(st.clock.elapsedTime * 1.2) * 0.1;
  });
  return (
    <mesh ref={ref} position={[0, 1.75, 0]}>
      <octahedronGeometry args={[0.4, 0]} />
      <meshStandardMaterial color="#7fe3ff" emissive="#2fa8d5" emissiveIntensity={1.2} />
    </mesh>
  );
}
