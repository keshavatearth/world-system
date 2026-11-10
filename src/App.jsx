import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, PerformanceMonitor } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { EffectComposer, Bloom, Vignette, TiltShift2 } from "@react-three/postprocessing";
import * as THREE from "three";
import World, { worldU } from "./World.jsx";
import { buildLayout } from "./layout.js";
import { setAmbience } from "./audio.js";
import { ExploreChrome, InkHover, POIBanner, SearchMode } from "./ui/WorldUI.jsx";

/* ------------------------------- helpers/meta ------------------------------- */
const KIND_META = {
  major: { label: "MAJOR REGION", icon: "🏞️", grad: "linear-gradient(135deg,#2e7d4f,#67c07a)" },
  area: { label: "TERRITORY", icon: "🌾", grad: "linear-gradient(135deg,#3d7a8a,#6fbfae)" },
  root: { label: "OUTPOST", icon: "🏜️", grad: "linear-gradient(135deg,#9a7a2e,#d9b45c)" },
  dot: { label: "HIDDEN CAVES", icon: "🕳️", grad: "linear-gradient(135deg,#3a4150,#6a7284)" },
  building: { label: "STRUCTURE", icon: "🏠", grad: "linear-gradient(135deg,#7a4f2e,#c9925e)" },
  repo: { label: "KEEP · GIT", icon: "🗼", grad: "linear-gradient(135deg,#3f5a78,#7d9cbd)" },
  hq: { label: "HEADQUARTERS", icon: "🏰", grad: "linear-gradient(135deg,#8a6a10,#e8c14d)" },
  agent: { label: "AGENT · LIVE", icon: "🧭", grad: "linear-gradient(135deg,#7a5a10,#d9a33c)" },
};
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
function freshness(ms) {
  if (!ms) return { t: "UNKNOWN", c: "#8a94a0" };
  const d = (Date.now() - ms) / 86400000;
  if (d < 7) return { t: "CURRENT", c: "#4caf6d" };
  if (d < 30) return { t: "RECENT", c: "#d9a53c" };
  return { t: "DORMANT", c: "#7d8794" };
}
const glass = {
  background: "linear-gradient(160deg, rgba(14,26,36,0.9), rgba(20,36,48,0.84))",
  border: "1px solid rgba(150,200,225,0.26)",
  borderRadius: 14,
  boxShadow: "0 8px 32px rgba(4,12,18,0.5), inset 0 1px 0 rgba(255,255,255,0.07)",
  backdropFilter: "blur(12px)",
  color: "#dfeef6",
};

/* ------------------------------ sun & sky model ------------------------------ */
function skyModel(tod) {
  // tod 0..1 → dawn → noon → dusk → night
  const daylight = Math.max(0, Math.sin(tod * Math.PI));
  const night = 1 - THREE.MathUtils.smoothstep(daylight, 0.04, 0.3);
  const az = (tod - 0.5) * Math.PI * 1.3;
  const sun = new THREE.Vector3(Math.sin(az) * 90, 20 + daylight * 100, Math.cos(az) * 60);
  const cDay = new THREE.Color("#bfe0ee"), cDusk = new THREE.Color("#f0b083"), cNight = new THREE.Color("#0e1a2b");
  const warm = 1 - Math.min(1, daylight * 1.6);
  const bg = cDay.clone().lerp(cDusk, warm * (1 - night)).lerp(cNight, night);
  const sunCol = new THREE.Color("#fff4dd").lerp(new THREE.Color("#ff9a5e"), warm);
  return { daylight, night, sun, bg: `#${bg.getHexString()}`, sunCol: `#${sunCol.getHexString()}`,
    sunI: 0.25 + daylight * 1.5, ambI: 0.18 + daylight * 0.5 };
}

/* -------------------------------- camera rig -------------------------------- */
function CameraRig({ apiRef, controlsRef, sky, spin, onInteract }) {
  const { camera } = useThree();
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.mouseButtons.wheel = CameraControlsImpl.ACTION.ZOOM;
    c.mouseButtons.right = CameraControlsImpl.ACTION.TRUCK;
    c.touches.two = CameraControlsImpl.ACTION.TOUCH_ZOOM_TRUCK;
    const start = () => onInteract(true);
    const end = () => onInteract(false);
    c.addEventListener("controlstart", start);
    c.addEventListener("controlend", end);
    return () => { c.removeEventListener("controlstart", start); c.removeEventListener("controlend", end); };
  }, [onInteract]);
  useEffect(() => {
    apiRef.current = {
      rotate(delta) { controlsRef.current?.rotate(delta, 0, true); },
      zoom(f) {
        const c = controlsRef.current; if (!c) return;
        c.zoomTo(Math.min(70, Math.max(2, camera.zoom * f)), true);
      },
      pan(dx, dz) {
        const c = controlsRef.current; if (!c) return;
        const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).negate();
        const t = c.getTarget(new THREE.Vector3());
        const move = fwd.multiplyScalar(dz).add(right.multiplyScalar(dx));
        c.moveTo(t.x + move.x, 0, t.z + move.z, true);
      },
      reset() {
        const c = controlsRef.current; if (!c) return;
        c.setLookAt(70, 90, 70, 0, 0, 0, true); c.zoomTo(7, true);
      },
      flyTo(x, z, zoom = 16) {
        const c = controlsRef.current; if (!c) return;
        c.moveTo(x, 0, z, true); if (zoom) c.zoomTo(zoom, true);
      },
    };
  }, [camera]);
  useFrame((_, dt) => {
    worldU.sunDir.value.copy(sky.sun).normalize();
    if (spin && controlsRef.current) { controlsRef.current.azimuthAngle += dt * 0.25; }
  });
  return null;
}

/* ---------------------------------- minimap --------------------------------- */
function Minimap({ layout, controlsRef, onJump }) {
  const cvs = useRef();
  const S = 168;
  const bounds = useMemo(() => {
    const R = layout.worldR + 30;
    return { min: -R, size: 2 * R };
  }, [layout]);
  useEffect(() => {
    let alive = true;
    const draw = () => {
      if (!alive) return;
      const ctx = cvs.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, S, S);
        ctx.fillStyle = "rgba(10,30,44,0.85)";
        ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 7); ctx.fill();
        const px = (v) => ((v - bounds.min) / bounds.size) * S;
        for (const lm of layout.landmasses) {
          const colors = { major: "#6fbf7d", area: "#8fbf6f", root: "#d9b45c", dot: "#59606c" };
          ctx.fillStyle = lm.stale ? "#5c6b74" : colors[lm.entry.kind] || "#999";
          ctx.beginPath();
          ctx.arc(px(lm.cx), px(lm.cz), Math.max(2, (lm.blobR / bounds.size) * S), 0, 7);
          ctx.fill();
        }
        const t = controlsRef.current?.target;
        if (t) {
          ctx.strokeStyle = "#ffd45e"; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(px(t.x), px(t.z), 7, 0, 7); ctx.stroke();
          ctx.fillStyle = "#ffd45e";
          ctx.beginPath(); ctx.arc(px(t.x), px(t.z), 2, 0, 7); ctx.fill();
        }
      }
      setTimeout(() => requestAnimationFrame(draw), 250);
    };
    draw();
    return () => { alive = false; };
  }, [layout, bounds]);
  return (
    <canvas ref={cvs} width={S} height={S}
      style={{ width: S, height: S, border: 0, borderRadius: "50%", background: "rgba(8,18,24,0.38)", cursor: "crosshair" }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const wx = ((e.clientX - r.left) / S) * bounds.size + bounds.min;
        const wz = ((e.clientY - r.top) / S) * bounds.size + bounds.min;
        onJump(wx, wz);
      }}
      title="minimap — click to sail there"
    />
  );
}

/* ------------------------------ command palette ----------------------------- */
function Palette({ layout, onGo, onClose }) {
  const [q, setQ] = useState("");
  const inputRef = useRef();
  useEffect(() => inputRef.current?.focus(), []);
  const results = useMemo(() => {
    const needle = q.toLowerCase();
    const out = [];
    for (const lm of layout.landmasses) {
      if (lm.entry.name.toLowerCase().includes(needle))
        out.push({ name: lm.entry.name, sub: lm.entry.kind, x: lm.cx, z: lm.cz, zoom: 14, sel: { kind: "landmass", data: lm.entry, lm } });
      for (const b of layout.buildings.filter((b) => b.lm === lm))
        if (b.child.name.toLowerCase().includes(needle))
          out.push({ name: b.child.name, sub: `in ${lm.entry.name}`, x: b.x, z: b.z, zoom: 24, sel: { kind: "building", data: b.child, parent: lm.entry } });
    }
    return out.slice(0, 9);
  }, [q, layout]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,12,18,0.55)", zIndex: 60, display: "flex", justifyContent: "center", paddingTop: "16vh" }}
      onClick={onClose}>
      <div style={{ ...glass, width: 440, height: "fit-content", padding: 10 }} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && results[0]) { onGo(results[0]); onClose(); }
          }}
          placeholder="⌘K — sail to any folder…"
          style={{ width: "100%", padding: "10px 12px", fontSize: 15, borderRadius: 9, border: "1px solid rgba(150,200,225,0.25)", background: "rgba(255,255,255,0.06)", color: "#eaf6fa", outline: "none", fontFamily: "inherit" }}
        />
        <div style={{ marginTop: 6 }}>
          {results.map((r, i) => (
            <div key={i}
              onClick={() => { onGo(r); onClose(); }}
              style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", borderRadius: 8, cursor: "pointer", background: i === 0 ? "rgba(255,212,94,0.12)" : "transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = i === 0 ? "rgba(255,212,94,0.12)" : "transparent")}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
              <span style={{ opacity: 0.55, fontSize: 11 }}>{r.sub}</span>
            </div>
          ))}
          {!results.length && <div style={{ padding: 10, opacity: 0.5, fontSize: 12 }}>no matches in the known world</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- card ----------------------------------- */
function StatBar({ value, max, color = "#67c07a" }) {
  const pct = Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.12)", marginTop: 3 }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: color, transition: "width .4s" }} />
    </div>
  );
}
function Card({ sel, onClose, maxItems, onFocus }) {
  const isHQ = sel.data.isHQ;
  const meta = isHQ ? KIND_META.hq
    : sel.kind === "agent" ? KIND_META.agent
    : sel.kind === "building" ? (sel.data.git ? KIND_META.repo : KIND_META.building)
    : KIND_META[sel.data.kind] || KIND_META.root;
  const fr = freshness(sel.data.mtime);
  return (
    <div style={{ ...glass, position: "absolute", right: 18, top: 18, width: 330, zIndex: 20, overflow: "hidden", animation: "cardIn .28s ease" }}>
      <div style={{ background: meta.grad, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 26, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.4))" }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: 2.4, opacity: 0.85, fontWeight: 700 }}>{meta.label}</div>
          <div style={{ fontSize: 19, fontWeight: 800, textShadow: "0 1px 3px rgba(0,0,0,.35)" }}>{sel.data.name}</div>
        </div>
        <span onClick={onClose} style={{ cursor: "pointer", opacity: 0.8, fontSize: 15, padding: 4 }}>✕</span>
      </div>
      <div style={{ padding: "12px 16px 14px" }}>
        <div style={{ fontFamily: "ui-monospace, Menlo", fontSize: 10, opacity: 0.55, wordBreak: "break-all", marginBottom: 10 }}>{sel.data.path}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, padding: "3px 9px", borderRadius: 20, background: fr.c + "33", color: fr.c, border: `1px solid ${fr.c}66` }}>● {fr.t}</span>
          {sel.data.git && (
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, padding: "3px 9px", borderRadius: 20,
              background: sel.data.git.dirty ? "#e0563f33" : "#4caf6d33",
              color: sel.data.git.dirty ? "#ff8a70" : "#6fd393",
              border: `1px solid ${sel.data.git.dirty ? "#e0563f66" : "#4caf6d66"}` }}>
              ⚑ {sel.data.git.dirty ? "GIT · DIRTY" : "GIT · CLEAN"}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ opacity: 0.6, fontSize: 10, letterSpacing: 1 }}>ITEMS</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{sel.data.itemCount ?? "—"}</div>
            <StatBar value={sel.data.itemCount || 0} max={maxItems} />
          </div>
          <div>
            <div style={{ opacity: 0.6, fontSize: 10, letterSpacing: 1 }}>LAST TOUCHED</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{fmtDate(sel.data.mtime)}</div>
          </div>
        </div>
        {sel.kind === "landmass" && sel.data.children?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.6, fontWeight: 800, marginBottom: 6 }}>STRUCTURES · {sel.data.children.length}</div>
            <div style={{ maxHeight: 170, overflowY: "auto", paddingRight: 4 }}>
              {sel.data.children.map((c) => (
                <div key={c.path} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 7, marginBottom: 2, background: "rgba(255,255,255,0.05)" }}>
                  <span style={{ fontSize: 13 }}>{c.isHQ ? "🏰" : c.git ? (c.git.dirty ? "🚩" : "🗼") : "🏠"}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ fontSize: 10, opacity: 0.55 }}>{c.itemCount}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {sel.parent && <div style={{ marginTop: 8, fontSize: 11, opacity: 0.6 }}>📍 in {sel.parent.name}</div>}
        <button onClick={onFocus}
          style={{ marginTop: 10, width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,212,94,0.5)", background: "rgba(255,212,94,0.14)", color: "#ffd45e", fontWeight: 800, letterSpacing: 2, fontSize: 11, cursor: "pointer" }}>
          ⌖ FOCUS
        </button>
      </div>
    </div>
  );
}

function CtrlBtn({ children, onClick, title, active }) {
  return (
    <button title={title} onClick={onClick}
      style={{ ...glass, width: 42, height: 42, borderRadius: 12, fontSize: 16, cursor: "pointer", display: "grid", placeItems: "center", padding: 0,
        ...(active ? { background: "linear-gradient(160deg, rgba(255,212,94,0.35), rgba(200,150,40,0.3))", borderColor: "#ffd45e88" } : {}) }}>
      {children}
    </button>
  );
}

/* ----------------------------------- app ----------------------------------- */
export default function App() {
  const [world, setWorld] = useState(null);
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [mouse, setMouse] = useState([0, 0]);
  const [spin, setSpin] = useState(false);
  const [tod, setTod] = useState(0.42);
  const [tilt, setTilt] = useState(true);
  const [audio, setAudio] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [splash, setSplash] = useState(true);
  const [interacting, setInteractingRaw] = useState(false);
  const [tier, setTier] = useState("full");
  const [agents, setAgents] = useState([]);
  const interactT = useRef();
  const setInteracting = useCallback((on) => {
    clearTimeout(interactT.current);
    if (on) setInteractingRaw(true);
    else interactT.current = setTimeout(() => setInteractingRaw(false), 170);
  }, []);
  const apiRef = useRef({});
  const controlsRef = useRef();

  useEffect(() => {
    fetch("/world.json").then((r) => r.json()).then(setWorld);
    const loadAgents = () => fetch("/agents.json").then((r) => r.json()).then((d) => setAgents(d.agents || [])).catch(() => {});
    loadAgents();
    const ai = setInterval(loadAgents, 20000);
    const t1 = setTimeout(() => window.dispatchEvent(new Event("resize")), 500);
    const t2 = setTimeout(() => window.dispatchEvent(new Event("resize")), 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearInterval(ai); };
  }, []);
  const layout = useMemo(() => (world ? buildLayout(world) : null), [world]);
  useEffect(() => {
    if (layout) { const t = setTimeout(() => setSplash(false), 900); return () => clearTimeout(t); }
  }, [layout]);

  const sky = useMemo(() => skyModel(tod), [tod]);
  const maxItems = useMemo(() => (world ? Math.max(...world.entries.map((e) => e.itemCount || 0)) : 100), [world]);
  const selectedLm = selected?.kind === "landmass" && selected.lm ? selected.lm : null;

  const go = useCallback((r) => {
    apiRef.current.flyTo?.(r.x, r.z, r.zoom);
    if (r.sel) setSelected(r.sel);
  }, []);

  // keyboard: pan/rotate/zoom/palette/focus
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      const api = apiRef.current;
      const step = 4;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); return; }
      switch (e.key.toLowerCase()) {
        case "arrowup": case "w": api.pan?.(0, step); break;
        case "arrowdown": case "s": api.pan?.(0, -step); break;
        case "arrowleft": case "a": api.pan?.(-step, 0); break;
        case "arrowright": case "d": api.pan?.(step, 0); break;
        case "q": api.rotate?.(Math.PI / 24); break;
        case "e": api.rotate?.(-Math.PI / 24); break;
        case "+": case "=": api.zoom?.(1.18); break;
        case "-": api.zoom?.(1 / 1.18); break;
        case "f": if (selectedLm) api.flyTo?.(selectedLm.cx, selectedLm.cz, 14); break;
        case "k": setPaletteOpen(true); break;
        case "escape": setSelected(null); break;
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLm]);

  const scanAgeH = world ? (Date.now() - new Date(world.generatedAt).getTime()) / 3600000 : 0;

  return (
    <div
      style={{ width: "100vw", height: "100vh", position: "relative", background: sky.bg, transition: "background 1s", fontFamily: "'Rubik', system-ui, sans-serif", overflow: "hidden" }}
      onMouseMove={(e) => setMouse([e.clientX, e.clientY])}
    >
      {layout && (
        <Canvas shadows dpr={interacting ? 1 : tier === "lite" ? [0.8, 1.25] : [1, 1.8]} orthographic camera={{ position: [70, 90, 70], zoom: 7, near: -800, far: 2500 }}>
          <color attach="background" args={[sky.bg]} />
          <ambientLight intensity={sky.ambI} />
          <hemisphereLight args={[sky.bg, "#3a5f4a", 0.3 + sky.daylight * 0.2]} />
          <directionalLight
            position={sky.sun.toArray()} intensity={sky.sunI} color={sky.sunCol} castShadow={tier === "full" && !interacting}
            shadow-mapSize={[1536, 1536]}
            shadow-camera-left={-170} shadow-camera-right={170}
            shadow-camera-top={170} shadow-camera-bottom={-170}
            shadow-bias={-0.0004}
          />
          <fog attach="fog" args={[sky.bg, 400, 800]} />
          <Suspense fallback={null}>
            <World layout={layout} agents={agents} onHover={setHover} onSelect={setSelected} selectedLm={selectedLm} night={sky.night} />
          </Suspense>
          <CameraControls
            ref={controlsRef}
            makeDefault
            smoothTime={0.32}
            draggingSmoothTime={0.11}
            minZoom={2} maxZoom={70}
            minPolarAngle={0.1}
            maxPolarAngle={Math.PI / 2.08}
          />
          <CameraRig apiRef={apiRef} controlsRef={controlsRef} sky={sky} spin={spin} onInteract={setInteracting} />
          <PerformanceMonitor factor={0.75} onDecline={() => setTier("lite")} />
          <EffectComposer multisampling={4}>
            <Bloom intensity={0.35 + sky.night * 0.5} luminanceThreshold={0.72} luminanceSmoothing={0.3} mipmapBlur />
            {tilt && !interacting ? <TiltShift2 blur={0.22} taper={0.6} /> : <></>}
            <Vignette darkness={0.28} offset={0.26} />
          </EffectComposer>
        </Canvas>
      )}

      <ExploreChrome
        layout={layout}
        scanAgeH={scanAgeH}
        tod={tod}
        setTod={setTod}
        night={sky.night}
        tilt={tilt}
        onToggleTilt={() => setTilt((value) => !value)}
        audio={audio}
        onToggleAudio={() => { setAmbience(!audio); setAudio((value) => !value); }}
        spin={spin}
        onToggleSpin={() => setSpin((value) => !value)}
        onOpenSearch={() => setPaletteOpen(true)}
        onRotateLeft={() => apiRef.current.rotate?.(Math.PI / 4)}
        onRotateRight={() => apiRef.current.rotate?.(-Math.PI / 4)}
        onZoomIn={() => apiRef.current.zoom?.(1.35)}
        onZoomOut={() => apiRef.current.zoom?.(1 / 1.35)}
        onReset={() => apiRef.current.reset?.()}
        minimap={layout ? <Minimap layout={layout} controlsRef={controlsRef} onJump={(x, z) => apiRef.current.flyTo?.(x, z, controlsRefZoom(controlsRef))} /> : null}
      />

      {hover && !selected && <InkHover hover={hover} mouse={mouse} />}

      {selected && (
        <POIBanner
          sel={selected}
          onClose={() => setSelected(null)}
          onFocus={() => {
            const building = layout?.buildings.find((candidate) => candidate.child.path === selected.data.path);
            const target = selected.lm
              ? { x: selected.lm.cx, z: selected.lm.cz, zoom: 14 }
              : building
                ? { x: building.x, z: building.z, zoom: 24 }
                : { x: selected.data.x ?? 0, z: selected.data.z ?? 0, zoom: 22 };
            apiRef.current.flyTo?.(target.x, target.z, target.zoom);
          }}
        />
      )}

      {paletteOpen && layout && <SearchMode layout={layout} onGo={go} onClose={() => setPaletteOpen(false)} />}

      {/* splash */}
      {splash && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", background: "linear-gradient(170deg,#0c1824,#123044)", transition: "opacity .7s", opacity: layout ? 0.985 : 1 }}>
          <div style={{ textAlign: "center", color: "#eaf6fa" }}>
            <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: 4 }}>🗺️ KESHAVATEARTH</div>
            <div style={{ fontSize: 12, letterSpacing: 6, opacity: 0.7, marginTop: 8 }}>CHARTING THE DEVICE…</div>
            <div style={{ width: 260, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 3, margin: "22px auto 0", overflow: "hidden" }}>
              <div style={{ width: "45%", height: "100%", borderRadius: 3, background: "linear-gradient(90deg,#ffd45e,#67c07a)", animation: "shimmer 1.1s ease-in-out infinite alternate" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function controlsRefZoom(ref) {
  const cam = ref.current?.object;
  return cam ? Math.max(10, cam.zoom) : 12;
}
