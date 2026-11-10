# Generated asset sources

Mode: built-in image-generation tool. These are production candidates, not adopted art direction or evidence of achieved renderer fidelity.

## Selection mask atlas v1

Output: `public/assets/selection/selection-mask-atlas-v1.png`

```text
Use case: stylized-concept
Asset type: renderer-ready monochrome brush-mask texture atlas for a 3D game's selection and contextual UI system
Input images: Images 1-4 are directional references only for restraint, dry-brush material, ink-wash hierarchy, and authored irregularity; do not reproduce any exact stroke, calligraphy, icon, layout, or copyrighted game asset
Primary request: create a clean texture atlas containing eight distinct original dry-brush marks that can be sampled as luminance masks: four wide horizontal selection strokes, two incomplete ground-ring/oval washes for projected decals, and two compact feathered ink fields for local POI labels
Scene/backdrop: perfectly uniform solid black background
Style/medium: high-resolution scanned sumi-like dry ink and weathered charcoal texture, organic fibres, broken edges, varied pressure, subtle gaps, materially rich but strictly monochrome
Composition/framing: eight non-overlapping white marks arranged in a precise 4-by-2 atlas grid with generous black gutters; every mark fully contained within its cell; no crop
Color palette: pure black background, white-to-light-gray marks only
Constraints: no text, no letters, no symbols, no logos, no watermark, no gradients or shadows outside the marks, no paper texture in the black background, no decorative objects; high contrast; each cell must remain separable for later UV sampling; original assets rather than copies of the references
```

Post-processing: black background removed through the installed chroma-key helper; output alpha and transparent corners validated.

## Terrain macro variation v1

Output: `public/assets/terrain/terrain-macro-variation-v1.png`

```text
Use case: stylized-concept
Asset type: square tileable low-frequency terrain macro-variation texture for a high-fidelity 3D world shader
Primary request: an original seamless overhead terrain colour-and-roughness variation field that breaks visible repetition across large island surfaces; broad irregular transitions among muted meadow green, moss, weathered earth, sparse dry grass, and cool exposed stone
Scene/backdrop: pure orthographic top-down material surface filling the entire square; no horizon and no empty background
Style/medium: premium stylized-realistic game terrain material, natural hand-authored variation, subtle painterly cohesion with physically plausible ground texture; intended to be multiplied softly over an existing PBR grass/ground material rather than serve as concept art
Composition/framing: square seamless tile; broad low-frequency patches cross every edge naturally; no central focal point; even distribution; edge-to-edge texture
Lighting/mood: neutral flat material capture with no directional light, no cast shadows, no highlights
Color palette: restrained moss and meadow greens, umber and ochre earth, gray-brown stone; low saturation and balanced value range
Materials/textures: grass fibres and soil grain remain subtle; macro shapes dominate; no deep cracks or height illusion
Constraints: seamless left-right and top-bottom edges, no trees, plants, flowers, rocks as separate objects, paths, buildings, water, snow, text, symbols, logos, borders, frame, vignette, perspective, shadows, or watermark; no obvious repeated motif; renderer-ready production texture rather than a landscape illustration
```

Post-processing: resized to 1024×1024. Seamlessness remains an adoption test in the running shader.
