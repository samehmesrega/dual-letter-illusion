# Dual Letter Illusion — Project Documentation
> Last updated: 2026-03-04 (Session 6) | Current state: WORKING with @jscad/modeling CSG

---

## What We Built

A browser-based 3D dual-letter illusion (ambigram) generator.

- **Input**: Two words (e.g. "SAMEH" + "NABIL")
- **Output**: A 3D object that reads as word A from 45°, word B from 135°
- **Export**: Binary STL file for 3D printing
- **Fonts**: 6 curated TTF fonts for letters + IBM Plex Arabic (hardcoded) for inscription

---

## Tech Stack

| Library | Version | Role |
|---|---|---|
| `three` | ^0.175.0 | 3D rendering, camera, lights, controls, STL export |
| `opentype.js` | ^1.3.4 | Parse TTF fonts, extract glyph paths |
| `@jscad/modeling` | ^3.3.2 | CSG: 2D shape building, extrusion, rotation, intersection |
| `vite` | ^6.3.0 | Build tool, dev server (port 3001→3003 if occupied) |

---

## Project Structure

```
dual-letter-illusion/
├── index.html
├── embed.html
├── package.json
├── vite.config.js
├── PROJECT_DOCS.md          ← this file
│
├── public/fonts/            ← 7 TTF files
│   └── [7 font files].ttf
│
└── src/
    ├── main.js
    ├── engine/
    │   ├── FontLoader.js
    │   ├── GlyphToJSCAD.js  ← CORE: glyph → JSCAD geom2
    │   ├── JscadToThree.js  ← CORE: JSCAD geom3 → Three.js BufferGeometry
    │   ├── AmbigramBuilder.js ← ORCHESTRATOR
    │   ├── SceneManager.js
    │   └── STLExporter.js
    ├── ui/
    │   ├── InputPanel.js
    │   └── PreviewPanel.js
    ├── fonts/
    │   └── curated-fonts.js ← 6 letter fonts + INSCRIPTION_FONT constant
    └── styles/
        └── main.css
```

---

## Core Algorithm

```
for each letter pair (charA, charB):
  1. opentype.js → glyph path commands (M/L/C/Q/Z)
  2. Sample bezier curves into polygon points (12 pts/curve, Y-flipped)
  3. Detect outers vs holes: signed area + bbox nesting depth
     - even depth = outer, odd depth = hole
  4. Build JSCAD geom2: outer CCW, holes subtracted via booleans.subtract
  5. Center geom2 at XY origin via transforms.translate
  6. extrudeLinear({ height: depth }) → geom3
  7. Center in Z: translate by -depth/2
  8. rotateY(PI/4) for A, rotateY(3*PI/4) for B
  9. booleans.intersect(rotA, rotB) → final geom3
     rotA = -PI/4 → face toward -X+Z (green arrow / "45°" view = Side A)
     rotB = +PI/4 → face toward +X+Z (yellow arrow / "135°" view = Side B)
     These two directions are perpendicular (dot product = 0) ✓
  10. Convert JSCAD polygon normals → Three.js BufferGeometry
  11. Place mesh at currentX, advance currentX += rW + spacing
  12. Stack all pairs side by side along X axis

Add base plate: BoxGeometry(totalWordWidth, 3, maxDepth + padding)
Center whole group at origin
```

**Extrusion depth** = `3 × max(boundsA.width, boundsA.height, boundsB.width, boundsB.height)`

**Letter spacing** = `8` units

---

## File-by-File API Reference

---

### `src/engine/FontLoader.js`

```js
loadFont(url: string): Promise<opentype.Font>
// Loads TTF from URL, caches in Map by URL key

loadFontFromBuffer(buffer: ArrayBuffer, key: string): opentype.Font
// Parses from ArrayBuffer, caches

clearCache(): void
```

---

### `src/engine/GlyphToJSCAD.js`

```js
glyphToJSCAD(font, char, fontSize=72):
  { shape: geom2, bounds: {minX,maxX,minY,maxY,width,height} } | null
// Main export. Converts one character to JSCAD 2D geometry.

getGlyphDebugLog(): string[]
// Returns debug messages from last glyphToJSCAD call
```

**Internal logic:**
- `samplePath(commands)` — converts M/L/C/Q/Z to polygon arrays, Y-flipped (-cmd.y)
- `cubicBezier(t, ...)` / `quadBezier(t, ...)` — bezier samplers, 12 segments/curve
- `computeSignedArea(points)` — Shoelace formula; positive = CCW, negative = CW
- `bboxInside(inner, outer)` — bbox containment for nesting detection
- `pointsToGeom2(points)` — converts `[x,y]` array → JSCAD `geom2` via sides

**Hole handling:**
- Outer: `signedArea < 0` → reverse points → CCW → pass to `booleans.union`
- Hole: `signedArea < 0` → reverse points → CCW → pass to `booleans.subtract`
  (both must be CCW for JSCAD subtract to work, regardless of TTF vs CFF font format)

**Known font issue:** OverpassMono-Bold has CFF glyph paths that cause visual artifacts
with the CSG intersection. Use other fonts for best results.

---

### `src/engine/JscadToThree.js`

```js
jscadToThree(jscadGeom: geom3): THREE.BufferGeometry
// Converts JSCAD geom3 → Three.js BufferGeometry
// Uses JSCAD's polygon plane normals directly (flat-face shading, correct winding)
// Fan triangulation: each polygon → N-2 triangles from first vertex
```

**Normal strategy:** Uses `poly.plane[0..2]` from JSCAD (guaranteed correct winding).
Falls back to cross-product of first 3 vertices if plane unavailable.
Does NOT use `computeVertexNormals()` or `mergeVertices()` — both caused issues.

---

### `src/engine/AmbigramBuilder.js`

```js
buildAmbigram(options): Promise<THREE.Group>

options = {
  textA: string,           // word for 45° view
  textB: string,           // word for 135° view
  fontUrl: string,         // e.g. '/fonts/Roboto-Bold.ttf'
  fontSize: 72,            // default 72
  spacing: 8,              // gap between letter pairs (X axis)
  baseHeight: 2,           // base plate height (1–5 mm)
  basePadding: 10,         // base plate padding around letters
  cornerRadius: 5,         // fillet radius (5–50 mm)
  inscriptionText: '',     // optional text engraved on base in front of letters
  inscriptionFontUrl: ''   // hardcoded to /fonts/IBMPlexSansArabic-Bold.ttf
}

// Returns: THREE.Group containing:
//   - N letter meshes named "pair_X_Y"
//   - 1 base plate mesh named "base_plate"
//   - Inscription character meshes (if inscriptionText provided)
//   - Group centered at world origin
```

**Layout:** Letters arranged **side by side along X axis** (NOT stacked on Y).
- `mesh.position.x = currentX - bbox.min.x`
- `currentX += rW + spacing`
- Base plate X position: `x = (currentX - spacing) / 2` (centered under letters)
- Base plate Y position: `y = -maxHeight/2 - baseHeight/2`
- Base height: `2` units default (controllable 1–5mm)
- Base padding: `10` units per side
- Base corners: fillet 5–50mm via JSCAD `roundedRectangle` + `extrudeLinear` → `jscadToThree` (watertight)
- **Inscription:** optional text on base plate, in front of letters (+Z side), readable from above
  - Font: IBM Plex Arabic (hardcoded, no user selection)
  - Font size auto-calculated: 7-word sentence ≤ 100mm width, capped at 14
  - Extruded 2mm above base surface via JSCAD pipeline (same as letters)
  - Base plate extends in +Z to accommodate inscription + padding

**Material:** `MeshStandardMaterial { color: 0xe8735a, roughness: 0.45, metalness: 0.0, DoubleSide }`

**Exports:** `debugLog: string[]` — full build log for Copy Debug button

---

### `src/engine/SceneManager.js`

```js
createScene(container: HTMLElement):
  { scene, camera, renderer, controls, animate(), dispose() }

fitCameraToObject(camera, object, controls, offset=1.5): void
// Smart camera framing: baseDim = Math.max(size.x, size.z, size.y * 0.5)
// Prevents camera going too far for tall multi-letter words
```

**Scene setup:**
- Background: `0x1a1a2e`
- Camera: `PerspectiveCamera(fov=50, near=0.1, far=10000)`, position `(150,100,150)`
- Renderer: WebGL, antialias, ACESFilmic tone mapping, exposure 1.2, shadow maps
- Controls: OrbitControls, damping 0.05, **autoRotate=false**, min/maxDistance 10–2000
- Lights: ambient 0.7 + key directional 0.8 + fill 0.3 + back 0.2
- Grid: `GridHelper(400, 40)` at y=-1

---

### `src/engine/STLExporter.js`

```js
exportToSTL(group: THREE.Group, filename='dual-letter-illusion.stl'): void
// Binary STL, triggers browser download

exportToSTLBlob(group: THREE.Group): Blob
// Returns Blob without downloading (for e-commerce/server upload)
```

---

### `src/ui/InputPanel.js`

```js
createInputPanel(container, callbacks): { getState(), setLoading(bool), enableDownload(bool) }

callbacks = {
  onChange(state),          // fired on any input change
  onGenerate(),             // Generate button
  onDownload(),             // Download STL button
  onWireframeToggle(bool)   // Wireframe toggle button
}
```

**UI elements:** text-a, text-b (maxlength=15), font-select, font-size slider (36–144, default 72), corner-radius slider (5–50), base-thickness slider (1–5), inscription-text input (maxlength=60), Generate button, Download STL button, Wireframe button

---

### `src/ui/PreviewPanel.js`

```js
createPreviewPanel(container): { setModel(group), showLoading(bool), showError(msg), clearError(), getRenderer() }
```

Wraps SceneManager. Handles model swap with geometry disposal, loading overlay, error display (auto-hides after 5s), placeholder text.

---

### `src/fonts/curated-fonts.js`

```js
export const CURATED_FONTS = [ { name, file, category }, ... ]  // 6 letter fonts
export const INSCRIPTION_FONT = 'IBMPlexSansArabic-Bold.ttf'    // hardcoded inscription font
export const DEFAULT_FONT = CURATED_FONTS[0]  // Anton
```

**6 letter fonts:**
- **Block** (3): Anton, Righteous, Squada One
- **Geometric** (2): Kanit Bold, Exo 2 Bold
- **Rounded** (1): Fredoka One

**Inscription font:** IBM Plex Sans Arabic Bold (hardcoded, supports Arabic + Latin)

---

## vite.config.js

```js
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: 'index.html', embed: 'embed.html' } }
  },
  server: { port: 3001 }
});
// NOTE: No optimizeDeps needed — @jscad/modeling is pure JS, not WASM
```

---

## Known Issues & Decisions

| Issue | Decision |
|---|---|
| OverpassMono-Bold glyph paths cause CSG artifacts | Don't use as default; it's last in the list |
| Hole winding differs between TTF and CFF fonts | Always ensure holes are CCW before `booleans.subtract` |
| Letters stacked on Y instead of X | Fixed: arrange along X axis (currentX tracking) |
| Base plate off-center | Fixed: base.position.x = (currentX - spacing) / 2 |
| Wrong name visible from 45° angle | Fixed: rotA=-PI/4 (face to -X+Z), rotB=+PI/4 (face to +X+Z); camera starts at -X side |
| three-bvh-csg fails with non-manifold font geometry | Switched to @jscad/modeling (pure JS, robust) |
| manifold-3d WASM had async/lifecycle issues | Switched to @jscad/modeling (sync, no WASM) |
| computeVertexNormals gave wrong results for CSG | Use JSCAD polygon plane normals directly |
| mergeVertices caused twisted surfaces on CSG | Removed; use per-polygon flat normals instead |

---

## Rebuild Prompt (Current State — JSCAD Approach)

Use this prompt with a fresh Claude instance to recreate this exact project:

```
Build a browser-based 3D dual-letter illusion (ambigram) generator.

## What it does
Takes two words as input (e.g. "SAMEH" + "NABIL"), generates a 3D object
that reads as word A when viewed from 45°, and word B from 135°.
Export as binary STL for 3D printing.

## Tech Stack
- three ^0.175.0 — 3D rendering, camera, lights, STL export
- opentype.js ^1.3.4 — TTF font parsing
- @jscad/modeling ^3.3.2 — all CSG: 2D shapes, extrusion, rotation, intersection
- vite ^6.3.0 — build tool, dev server port 3001
- Vanilla JS + CSS, no framework

## Core Pipeline (per letter pair)
1. opentype.js font.getPath(char, 0, 0, fontSize)
2. Sample M/L/C/Q/Z commands → polygon arrays:
   - FLIP Y: use -cmd.y everywhere
   - Bezier sampling: 12 points per curve segment
3. Compute signed area (Shoelace formula) per contour
4. Detect holes via bbox containment + nesting depth:
   count how many other contour bboxes contain this one
   even depth = outer, odd depth = hole
5. Build JSCAD geom2:
   - Outer: if signedArea < 0, reverse points → CCW → booleans.union
   - Hole: if signedArea < 0, reverse points → CCW → booleans.subtract
   CRITICAL: both outer AND hole must be CCW for subtract to work correctly
   This handles both TTF (TrueType) and CFF (OpenType) font formats
6. Center geom2: transforms.translate([-cx, -cy, 0], shape)
7. Extrude: extrusions.extrudeLinear({ height: extrudeDepth }, shape)
   extrudeDepth = 3 × max(widthA, heightA, widthB, heightB)
8. Center in Z: transforms.translate([0, 0, -extrudeDepth/2], ext)
9. Rotate: transforms.rotateY(PI/4, extA), transforms.rotateY(3*PI/4, extB)
10. Intersect: booleans.intersect(rotA, rotB)
11. Convert to Three.js BufferGeometry via JSCAD polygon normals

## JscadToThree conversion (CRITICAL — do NOT use computeVertexNormals)
- geometries.geom3.toPolygons(geom3) → array of polygons
- Each polygon has: .vertices (array of [x,y,z]) and .plane ([nx,ny,nz,w])
- Fan triangulate each polygon from vertex 0
- Use poly.plane[0..2] as the normal for ALL vertices in that polygon
- Fallback: compute normal from cross product of first 3 vertices
- setAttribute 'position' AND 'normal' explicitly
- Do NOT call computeVertexNormals() — gives wrong results for CSG
- Do NOT use mergeVertices() — causes twisted surfaces

## Letter Layout
- Letters arranged SIDE BY SIDE along X axis (NOT stacked on Y)
- mesh.position.x = currentX - bbox.min.x
- currentX += rW + spacing (spacing = 8)
- On skip: currentX += fontSize * 0.5
- Base plate: BoxGeometry(totalWordWidth + 2*padding, 3, maxDepth + 2*padding)
- Base plate Y: -maxHeight/2 - baseHeight/2
- Center entire group at world origin after assembly

## SceneManager
- PerspectiveCamera: fov=50, position (150,100,150), lookAt origin
- OrbitControls: autoRotate=FALSE, enableDamping=true, dampingFactor=0.05
- Ambient light: 0.7, key directional: 0.8, fill: 0.3, back: 0.2
- Background: 0x1a1a2e
- fitCameraToObject: baseDim = Math.max(size.x, size.z, size.y * 0.5)
  (critical for tall multi-letter words — prevents camera too far)
- Camera placed at (-distance*0.7, distance*0.5, distance*0.7) — negative X so Side A is visible on open
- To see Side A: orbit to -X+Z quadrant (green arrow / "45°")
- To see Side B: orbit to +X+Z quadrant (yellow arrow / "135°")

## Material
MeshStandardMaterial { color: 0x4a9eff, roughness: 0.3, metalness: 0.1, side: DoubleSide }

## File Structure
src/engine/FontLoader.js        — opentype.js load+cache
src/engine/GlyphToJSCAD.js     — glyph → JSCAD geom2 (with holes)
src/engine/JscadToThree.js     — JSCAD geom3 → Three.js BufferGeometry
src/engine/AmbigramBuilder.js  — orchestrator (async, returns THREE.Group)
src/engine/SceneManager.js     — scene, camera, lights, controls
src/engine/STLExporter.js      — binary STL download
src/ui/InputPanel.js           — text inputs, font picker, size slider
src/ui/PreviewPanel.js         — 3D canvas wrapper with loading/error states
src/fonts/curated-fonts.js     — 26 font definitions
src/styles/main.css            — dark theme, responsive
src/main.js                    — wires UI to engine, debounced auto-generate (800ms)
index.html / embed.html / vite.config.js

## 26 Fonts (all TTFs in public/fonts/)
Geometric: Roboto-Bold, Montserrat-Bold, Poppins-Bold, Inter-Bold, Raleway-Bold,
           Nunito-Bold, Rubik-Bold, WorkSans-Bold, Outfit-Bold, Lexend-Bold
Block:     Anton-Regular, BebasNeue-Regular, Oswald-Bold, BlackOpsOne-Regular,
           Bungee-Regular, Teko-Bold, RussoOne-Regular
Rounded:   Comfortaa-Bold, Quicksand-Bold, VarelaRound-Regular
Slab:      RobotoSlab-Bold, AlfaSlabOne-Regular, CreteRound-Regular
Mono:      SpaceMono-Bold, JetBrainsMono-Bold, OverpassMono-Bold
DEFAULT = Roboto Bold (OverpassMono has CFF glyph issues — avoid as default)

## UI
- Left panel 320px: two text inputs (maxlength=10), font select dropdown,
  fontSize range slider (36–144 default 72), Generate + Download STL +
  Wireframe toggle + Copy Debug buttons
- Right panel flex: Three.js canvas
- Dark theme: background #1a1a2e
- Debounced auto-generate on input change: 800ms
- Show length-mismatch warning if textA.length ≠ textB.length

## Build order
1. package.json + vite.config.js
2. src/engine/SceneManager.js
3. src/engine/FontLoader.js
4. src/engine/GlyphToJSCAD.js   ← test A+A and O+O first
5. src/engine/JscadToThree.js
6. src/engine/AmbigramBuilder.js
7. src/engine/STLExporter.js
8. src/ui/InputPanel.js + PreviewPanel.js
9. src/fonts/curated-fonts.js
10. src/main.js + index.html + embed.html + main.css

## Test sequence
1. Single letter: A+A (has hole), O+O (round hole), S+S (curves)
2. Word: SAMEH+NABIL (5 pairs, tests spacing)
3. Different lengths: LOVE+HATE (padding test)
4. Download STL → open in 3D viewer → confirm watertight
```

---

## Changelog

| Date | Change |
|---|---|
| Session 1 | Built initial pipeline: three-bvh-csg + THREE.ShapePath |
| Session 2 | Switched to manifold-3d WASM for CSG |
| Session 3 | Switched to @jscad/modeling (pure JS, sync, most reliable) |
| Session 3 | Fixed hole winding bug: ensure CCW for both TTF and CFF fonts |
| Session 3 | Fixed letter layout: X-axis side-by-side (was Y-axis stacked) |
| Session 3 | Fixed normals: use JSCAD polygon plane normals directly |
| Session 3 | Added all 26 fonts to curated-fonts.js (was only 1) |
| Session 3 | Identified OverpassMono-Bold as problematic (CFF glyph paths) |
| Session 4 | Fixed main.js: initial fontFile was hardcoded to OverpassMono — now uses DEFAULT_FONT.file (Roboto Bold) |
| Session 4 | Fixed base plate X alignment: added base.position.x = (currentX - spacing) / 2 |
| Session 4 | Fixed rotation angles: rotA = -PI/4 (face toward -X+Z, green-arrow/45° side), rotB = +PI/4 (face toward +X+Z, yellow-arrow/135° side) |
| Session 4 | Fixed camera: initial position and fitCameraToObject now use -X direction so Side A appears on open |
| Session 4 | Base height changed from 3 to 1.5 (1.5mm); base corners filleted 5mm via THREE.Shape + ExtrudeGeometry |
| Session 4 | Fixed base plate invisible faces: rotateX was +PI/2 (normals pointing down) → changed to -PI/2 (normals pointing up); translate sign fixed; added DoubleSide |
| Session 5 | Unified color: letters + base → 0xe8735a terracotta; fillet slider 5–50mm; base thickness slider 1–5mm |
| Session 5 | Fixed base plate corner gaps: replaced boxes+CylinderGeometry with JSCAD roundedRectangle + extrudeLinear → jscadToThree (same proven pipeline as letters) |
| Session 5 | Added inscription feature: optional text on base plate, readable from above, 2mm raised, auto-sized (7 words ≤ 10cm), base extends forward to fit |
| Session 5 | CSS overhaul: custom vars, focus rings, styled range thumbs, custom select arrow, mobile responsive |
| Session 5 | Arabic inscription support: added `textToJSCAD()` for full-string rendering (shaping, RTL, ligatures); added Cairo Bold + Tajawal Bold fonts |
| Session 5 | Added separate inscription font dropdown with Arabic fonts; tested 22+ Arabic fonts |
| Session 6 | Simplified inscription font: removed dropdown, hardcoded IBM Plex Arabic as only inscription font |
| Session 6 | Cleaned up fonts: removed 50 unused TTF files, keeping only 7 (6 letter fonts + IBM Plex Arabic) |
| Session 6 | Replaced `ARABIC_FONTS` array with single `INSCRIPTION_FONT` constant |
