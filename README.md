# world-system

An abandoned experiment from July 2026: a 3D "world" view of a Mac's home folder, where folders become landmasses and running coding agents show up on the islands they are working in. Built with React Three Fiber and Vite.

It did not work out as a way to manage work, so this is an archive of the code only.

## Run it

```bash
npm install
npm run scan          # writes public/world.json from your own home folder
node scan-agents.mjs  # writes public/agents.json from recent Claude Code and Codex sessions
npm run dev
```

`public/world.json` and `public/agents.json` describe the machine they were generated on, so they are not in the repo.

## Assets

Textures are CC0 (ambientCG) or MIT (three.js examples); see `public/textures/PROVENANCE.md`. The two generated images are described in `public/assets/MANIFEST.md`.
