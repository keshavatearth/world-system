import { useEffect, useMemo, useRef, useState } from "react";
import "./world-ui.css";

const kindLabel = (sel) => {
  if (sel?.data?.isHQ) return "HEADQUARTERS";
  if (sel?.kind === "agent") return `AGENT · ${sel.data.engine || "SESSION"}`;
  if (sel?.kind === "building") return sel.data.git ? "GIT KEEP" : "STRUCTURE";
  return ({ major: "MAJOR REGION", area: "TERRITORY", root: "OUTPOST", dot: "HIDDEN TERRITORY" })[sel?.data?.kind] || "KNOWN PLACE";
};

const dateLabel = (value) => {
  if (!value) return "Unknown";
  const parsed = typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(parsed)) return "Unknown";
  return new Date(parsed).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const statusLabel = (sel) => {
  if (sel.kind === "agent") return (sel.data.status || "unknown").toUpperCase();
  if (!sel.data.mtime) return "UNKNOWN";
  const days = (Date.now() - sel.data.mtime) / 86_400_000;
  if (days < 7) return "CURRENT";
  if (days < 30) return "RECENT";
  return "DORMANT";
};

export function ExploreChrome({
  layout,
  scanAgeH,
  tod,
  setTod,
  night,
  tilt,
  onToggleTilt,
  audio,
  onToggleAudio,
  spin,
  onToggleSpin,
  onOpenSearch,
  onRotateLeft,
  onRotateRight,
  onZoomIn,
  onZoomOut,
  onReset,
  minimap,
}) {
  const props = layout ? Object.values(layout.props).reduce((sum, values) => sum + values.length, 0) : 0;
  return (
    <div className="ws-layer" aria-label="World navigation">
      <header className="ws-brand">
        <span className="ws-brand__eyebrow">A projection of this device</span>
        <h1>Keshav / Earth</h1>
        {layout && (
          <div className="ws-brand__world-truth">
            <span>{layout.landmasses.length} territories</span>
            <span>{layout.buildings.length} structures</span>
            <span>{props.toLocaleString()} environmental marks</span>
            {scanAgeH > 24 && <span>Survey {Math.round(scanAgeH)}h old</span>}
          </div>
        )}
      </header>

      <div className="ws-top-actions">
        <div className="ws-time">
          <span className="ws-micro-label">{night > 0.5 ? "Night" : tod < 0.25 || tod > 0.75 ? "Dusk" : "Day"}</span>
          <input aria-label="Time of day" type="range" min="0.02" max="0.98" step="0.01" value={tod} onChange={(event) => setTod(Number(event.target.value))} />
        </div>
        <button className="ws-text-action" type="button" onClick={onOpenSearch}>Find <span aria-hidden="true">⌘K</span></button>
        <button className={`ws-text-action ${tilt ? "is-active" : ""}`} type="button" onClick={onToggleTilt}>Focus</button>
        <button className={`ws-text-action ${audio ? "is-active" : ""}`} type="button" onClick={onToggleAudio}>{audio ? "Sound" : "Silent"}</button>
      </div>

      {minimap && <div className="ws-minimap">{minimap}<span className="ws-minimap__label ws-micro-label">Atlas</span></div>}

      <div className="ws-legend" aria-label="World legend">
        <span><b>HQ</b> headquarters</span>
        <span><b>Keep</b> repository</span>
        <span><b>Cloud</b> dormant</span>
        <span><b>Vessel</b> major route</span>
        <span>Drag orbit · right-drag pan · WASD / QE</span>
      </div>

      <nav className="ws-camera-controls" aria-label="Camera controls">
        <button className="ws-glyph-action" title="Rotate left" type="button" onClick={onRotateLeft}>↶</button>
        <button className="ws-glyph-action" title="Rotate right" type="button" onClick={onRotateRight}>↷</button>
        <span className="ws-camera-controls__divider" />
        <button className="ws-glyph-action" title="Zoom in" type="button" onClick={onZoomIn}>＋</button>
        <button className="ws-glyph-action" title="Zoom out" type="button" onClick={onZoomOut}>−</button>
        <button className={`ws-glyph-action ${spin ? "is-active" : ""}`} title="Auto orbit" type="button" onClick={onToggleSpin}>{spin ? "■" : "▶"}</button>
        <button className="ws-glyph-action" title="Return home" type="button" onClick={onReset}>⌂</button>
      </nav>
    </div>
  );
}

export function InkHover({ hover, mouse }) {
  if (!hover) return null;
  const x = Math.min(mouse[0] + 18, window.innerWidth - 300);
  const y = Math.min(mouse[1] + 14, window.innerHeight - 88);
  const status = hover.kind === "agent" ? hover.data.status : `${hover.data.itemCount ?? "?"} items`;
  return (
    <div className="ws-hover-label" style={{ left: x, top: y }}>
      <strong>{hover.data.name}</strong>
      <span>{hover.parent ? `${hover.parent.name} · ` : ""}{status}</span>
    </div>
  );
}

export function POIBanner({ sel, onClose, onFocus }) {
  if (!sel) return null;
  const status = statusLabel(sel);
  const children = sel.kind === "landmass" ? sel.data.children || [] : [];
  const date = sel.kind === "agent" ? sel.data.lastEventAt : sel.data.mtime;
  return (
    <aside className="ws-poi" aria-label={`${sel.data.name} details`}>
      <button className="ws-poi__close" type="button" onClick={onClose} aria-label="Close details">×</button>
      <div className="ws-poi__kind">{kindLabel(sel)}</div>
      <h2>{sel.data.name}</h2>
      <div className="ws-poi__path">{sel.data.displayPath || sel.data.path || sel.parent?.name || "Mapped locally"}</div>
      <div className="ws-poi__status">
        <span className={status === "CURRENT" || status === "ACTIVE" ? "is-active" : ""}>{status}</span>
        {sel.data.git && <span>{sel.data.git.dirty ? "Uncommitted changes" : "Repository clean"}</span>}
      </div>

      <dl className="ws-poi__facts">
        <div className="ws-poi__fact"><dt>{sel.kind === "agent" ? "Engine" : "Contents"}</dt><dd>{sel.kind === "agent" ? sel.data.engine || "Unknown" : sel.data.itemCount ?? "—"}</dd></div>
        <div className="ws-poi__fact"><dt>{sel.kind === "agent" ? "Last signal" : "Last touched"}</dt><dd>{dateLabel(date)}</dd></div>
      </dl>

      {children.length > 0 && (
        <section className="ws-poi__structures">
          <h3>Structures · {children.length}</h3>
          {children.slice(0, 12).map((child) => (
            <div className="ws-poi__structure" key={child.path}>
              <span aria-hidden="true">{child.isHQ ? "✦" : child.git ? "◆" : "·"}</span>
              <strong>{child.name}</strong>
              <small>{child.itemCount ?? "—"}</small>
            </div>
          ))}
        </section>
      )}

      {sel.parent && <div className="ws-micro-label">Within {sel.parent.name}</div>}
      <button className="ws-poi__primary" type="button" onClick={onFocus}>Focus here <span aria-hidden="true">⌖</span></button>
    </aside>
  );
}

export function SearchMode({ layout, onGo, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef(null);
  useEffect(() => input.current?.focus(), []);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const found = [];
    for (const landmass of layout.landmasses) {
      if (!needle || landmass.entry.name.toLowerCase().includes(needle)) {
        found.push({ name: landmass.entry.name, sub: landmass.entry.kind, x: landmass.cx, z: landmass.cz, zoom: 14, sel: { kind: "landmass", data: landmass.entry, lm: landmass } });
      }
      for (const building of layout.buildings.filter((candidate) => candidate.lm === landmass)) {
        if (!needle || building.child.name.toLowerCase().includes(needle)) {
          found.push({ name: building.child.name, sub: `within ${landmass.entry.name}`, x: building.x, z: building.z, zoom: 24, sel: { kind: "building", data: building.child, parent: landmass.entry } });
        }
      }
    }
    return found.slice(0, 10);
  }, [query, layout]);

  const travel = (result) => { onGo(result); onClose(); };
  return (
    <section className="ws-search" role="dialog" aria-modal="true" aria-label="Search the known world">
      <button className="ws-search__close" type="button" onClick={onClose}>Back · Esc</button>
      <div className="ws-search__aside">
        <div><span className="ws-micro-label">Known world</span><h2>Choose a place</h2></div>
        <p>Names emerge from the device survey. Select a territory or structure, then travel deliberately.</p>
      </div>
      <div className="ws-search__main">
        <input
          className="ws-search__input"
          ref={input}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(results.length - 1, index + 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
            if (event.key === "Enter" && results[active]) travel(results[active]);
          }}
          placeholder="Search territories and structures…"
          aria-label="Search territories and structures"
        />
        <div className="ws-search__results" role="listbox">
          {results.map((result, index) => (
            <button className={`ws-search__result ${active === index ? "is-active" : ""}`} type="button" key={`${result.name}-${result.x}-${result.z}`} onMouseEnter={() => setActive(index)} onClick={() => travel(result)} role="option" aria-selected={active === index}>
              <span><strong>{result.name}</strong><small>{result.sub}</small></span>
              <span className="ws-micro-label">Travel ↗</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
