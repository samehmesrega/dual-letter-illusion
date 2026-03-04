import { geometries, booleans, transforms } from '@jscad/modeling';

const { geom2 } = geometries;

const glyphDebug = [];
export function getGlyphDebugLog() { return glyphDebug.slice(); }
function dbg(msg) { glyphDebug.push(msg); console.log(msg); }

/**
 * Convert an opentype.js glyph to a JSCAD geom2 ready for extrusion.
 * Handles holes (O, A, B, D, P, R, etc.) via JSCAD boolean subtract.
 *
 * @param {opentype.Font} font
 * @param {string} char
 * @param {number} fontSize
 * @returns {{ shape: geom2, bounds: {minX,minY,maxX,maxY,width,height} } | null}
 */
export function glyphToJSCAD(font, char, fontSize = 72) {
  glyphDebug.length = 0;
  dbg(`[GlyphToJSCAD] '${char}' size=${fontSize}`);

  // Heart symbol — generate programmatically (works with all fonts)
  if (char === '\u2665' || char === '\u2764') {
    return buildHeartShape(fontSize, glyphToJSCAD._heartStyle || 1);
  }

  const glyphPath = font.getPath(char, 0, 0, fontSize);
  const contours = samplePath(glyphPath.commands);

  if (contours.length === 0) {
    dbg('  no contours');
    return null;
  }

  // Compute signed area and bbox for each contour
  for (const c of contours) {
    c.signedArea = computeSignedArea(c.points);
    c.absArea = Math.abs(c.signedArea);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of c.points) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    c.minX = minX; c.maxX = maxX; c.minY = minY; c.maxY = maxY;
  }

  // Remove degenerate contours
  const valid = contours.filter(c => c.absArea > 1 && c.points.length >= 3);
  if (valid.length === 0) { dbg('  all contours degenerate'); return null; }

  // Sort by area descending
  valid.sort((a, b) => b.absArea - a.absArea);

  // Detect holes via bbox nesting depth (even = outer, odd = hole)
  for (const c of valid) {
    let depth = 0;
    for (const other of valid) {
      if (other !== c && bboxInside(c, other)) depth++;
    }
    c.isHole = (depth % 2) === 1;
    dbg(`  contour: area=${c.signedArea.toFixed(1)}, depth=${depth}, isHole=${c.isHole}`);
  }

  const outers = valid.filter(c => !c.isHole);
  const holes  = valid.filter(c =>  c.isHole);
  dbg(`  ${outers.length} outers, ${holes.length} holes`);

  if (outers.length === 0) return null;

  // Build combined outer shape
  let combined = null;
  for (const outer of outers) {
    // Ensure CCW (positive signed area) for outer
    const pts = outer.signedArea < 0 ? [...outer.points].reverse() : outer.points;
    try {
      const shape = pointsToGeom2(pts);
      combined = combined ? booleans.union(combined, shape) : shape;
    } catch (e) {
      dbg(`  outer build error: ${e.message}`);
    }
  }

  if (!combined) return null;

  // Subtract holes — ensure CCW for subtract regardless of font format (TTF vs CFF)
  for (const hole of holes) {
    try {
      const holePts = hole.signedArea < 0 ? [...hole.points].reverse() : hole.points;
      const holeShape = pointsToGeom2(holePts);
      combined = booleans.subtract(combined, holeShape);
    } catch (e) {
      dbg(`  hole subtract error: ${e.message}`);
    }
  }

  // Compute overall bounding box
  const allPts = valid.flatMap(c => c.points);
  const minX = Math.min(...allPts.map(p => p[0]));
  const maxX = Math.max(...allPts.map(p => p[0]));
  const minY = Math.min(...allPts.map(p => p[1]));
  const maxY = Math.max(...allPts.map(p => p[1]));
  const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };

  dbg(`  bounds: ${bounds.width.toFixed(1)} x ${bounds.height.toFixed(1)}`);

  return { shape: combined, bounds };
}

/**
 * Convert a full text string to JSCAD geom2 (handles Arabic shaping, RTL, ligatures, kerning).
 * Uses font.getPath() for the entire string instead of per-character.
 */
export function textToJSCAD(font, text, fontSize = 72) {
  glyphDebug.length = 0;
  dbg(`[textToJSCAD] "${text}" size=${fontSize}`);

  const textPath = font.getPath(text, 0, 0, fontSize);
  const contours = samplePath(textPath.commands);

  if (contours.length === 0) {
    dbg('  no contours');
    return null;
  }

  // Same contour analysis as glyphToJSCAD
  for (const c of contours) {
    c.signedArea = computeSignedArea(c.points);
    c.absArea = Math.abs(c.signedArea);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of c.points) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    c.minX = minX; c.maxX = maxX; c.minY = minY; c.maxY = maxY;
  }

  const valid = contours.filter(c => c.absArea > 1 && c.points.length >= 3);
  if (valid.length === 0) { dbg('  all contours degenerate'); return null; }

  valid.sort((a, b) => b.absArea - a.absArea);

  // Detect holes via bbox nesting depth
  for (const c of valid) {
    let depth = 0;
    for (const other of valid) {
      if (other !== c && bboxInside(c, other)) depth++;
    }
    c.isHole = (depth % 2) === 1;
  }

  const outers = valid.filter(c => !c.isHole);
  const holes  = valid.filter(c =>  c.isHole);
  dbg(`  ${outers.length} outers, ${holes.length} holes`);

  if (outers.length === 0) return null;

  let combined = null;
  for (const outer of outers) {
    const pts = outer.signedArea < 0 ? [...outer.points].reverse() : outer.points;
    try {
      const shape = pointsToGeom2(pts);
      combined = combined ? booleans.union(combined, shape) : shape;
    } catch (e) {
      dbg(`  outer build error: ${e.message}`);
    }
  }

  if (!combined) return null;

  for (const hole of holes) {
    try {
      const holePts = hole.signedArea < 0 ? [...hole.points].reverse() : hole.points;
      const holeShape = pointsToGeom2(holePts);
      combined = booleans.subtract(combined, holeShape);
    } catch (e) {
      dbg(`  hole subtract error: ${e.message}`);
    }
  }

  const allPts = valid.flatMap(c => c.points);
  const minX = Math.min(...allPts.map(p => p[0]));
  const maxX = Math.max(...allPts.map(p => p[0]));
  const minY = Math.min(...allPts.map(p => p[1]));
  const maxY = Math.max(...allPts.map(p => p[1]));
  const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };

  dbg(`  bounds: ${bounds.width.toFixed(1)} x ${bounds.height.toFixed(1)}`);
  return { shape: combined, bounds };
}

// ── JSCAD helpers ─────────────────────────────────────────────────────────────

function pointsToGeom2(points) {
  const sides = [];
  for (let i = 0; i < points.length; i++) {
    sides.push([points[i], points[(i + 1) % points.length]]);
  }
  return geom2.create(sides);
}

// ── Path sampling ─────────────────────────────────────────────────────────────

const NUM_SEG = 12;

function samplePath(commands) {
  const contours = [];
  let current = null;
  let cx = 0, cy = 0;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (current && current.length >= 3) contours.push({ points: current });
        current = [[cmd.x, -cmd.y]];
        cx = cmd.x; cy = cmd.y;
        break;
      case 'L':
        current.push([cmd.x, -cmd.y]);
        cx = cmd.x; cy = cmd.y;
        break;
      case 'C':
        for (let k = 1; k <= NUM_SEG; k++) {
          const t = k / NUM_SEG;
          const p = cubicBezier(t, cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
          current.push([p[0], -p[1]]);
        }
        cx = cmd.x; cy = cmd.y;
        break;
      case 'Q':
        for (let k = 1; k <= NUM_SEG; k++) {
          const t = k / NUM_SEG;
          const p = quadBezier(t, cx, cy, cmd.x1, cmd.y1, cmd.x, cmd.y);
          current.push([p[0], -p[1]]);
        }
        cx = cmd.x; cy = cmd.y;
        break;
      case 'Z':
        if (current && current.length >= 3) contours.push({ points: current });
        current = null;
        break;
    }
  }
  if (current && current.length >= 3) contours.push({ points: current });
  return contours;
}

function cubicBezier(t, x0, y0, x1, y1, x2, y2, x3, y3) {
  const u = 1 - t;
  return [
    u*u*u*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3,
    u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3
  ];
}

function quadBezier(t, x0, y0, x1, y1, x2, y2) {
  const u = 1 - t;
  return [
    u*u*x0 + 2*u*t*x1 + t*t*x2,
    u*u*y0 + 2*u*t*y1 + t*t*y2
  ];
}

// ── Heart shape builder (20 variants) ────────────────────────────────────────

// Each variant = array of right-half bezier curves [{x0,y0,x1,y1,x2,y2,x3,y3}, ...]
// Mirrored on X for left half. All start at bottom-center (0,0).
const HEART_VARIANTS = [
  // 1: Classic wide — large lobes, flat bottom
  [{ x0:0,y0:0, x1:10,y1:0, x2:20,y2:10, x3:20,y3:22 }, { x0:20,y0:22, x1:20,y1:36, x2:4,y2:36, x3:0,y3:24 }],
  // 2: Tall narrow — elongated
  [{ x0:0,y0:0, x1:6,y1:0, x2:14,y2:8, x3:14,y3:20 }, { x0:14,y0:20, x1:14,y1:36, x2:3,y2:38, x3:0,y3:26 }],
  // 3: Chubby round — very wide lobes
  [{ x0:0,y0:0, x1:12,y1:0, x2:24,y2:8, x3:24,y3:18 }, { x0:24,y0:18, x1:24,y1:32, x2:6,y2:34, x3:0,y3:22 }],
  // 4: Compact — small proportional
  [{ x0:0,y0:0, x1:8,y1:0, x2:16,y2:6, x3:16,y3:14 }, { x0:16,y0:14, x1:16,y1:26, x2:4,y2:28, x3:0,y3:18 }],
  // 5: Angular — sharper transitions
  [{ x0:0,y0:0, x1:4,y1:0, x2:18,y2:2, x3:18,y3:18 }, { x0:18,y0:18, x1:18,y1:34, x2:2,y2:34, x3:0,y3:22 }],
  // 6: Soft — very round smooth curves
  [{ x0:0,y0:0, x1:14,y1:0, x2:22,y2:12, x3:22,y3:20 }, { x0:22,y0:20, x1:22,y1:30, x2:8,y2:34, x3:0,y3:24 }],
  // 7: Flat wide — low profile, wide
  [{ x0:0,y0:0, x1:12,y1:0, x2:24,y2:6, x3:24,y3:14 }, { x0:24,y0:14, x1:24,y1:24, x2:6,y2:26, x3:0,y3:18 }],
  // 8: Tall slim — narrow and tall
  [{ x0:0,y0:0, x1:5,y1:0, x2:12,y2:10, x3:12,y3:24 }, { x0:12,y0:24, x1:12,y1:40, x2:3,y2:42, x3:0,y3:30 }],
  // 9: Deep cleft — pronounced top dip
  [{ x0:0,y0:0, x1:10,y1:0, x2:20,y2:10, x3:20,y3:24 }, { x0:20,y0:24, x1:20,y1:38, x2:6,y2:32, x3:0,y3:18 }],
  // 10: Shallow cleft — minimal top dip
  [{ x0:0,y0:0, x1:10,y1:0, x2:20,y2:10, x3:20,y3:20 }, { x0:20,y0:20, x1:20,y1:32, x2:4,y2:36, x3:0,y3:28 }],
  // 11: Asymmetric feel — wider bottom curve
  [{ x0:0,y0:0, x1:16,y1:0, x2:20,y2:8, x3:20,y3:18 }, { x0:20,y0:18, x1:20,y1:32, x2:4,y2:34, x3:0,y3:24 }],
  // 12: Balloon — very round, almost circular lobes
  [{ x0:0,y0:0, x1:10,y1:0, x2:22,y2:14, x3:22,y3:22 }, { x0:22,y0:22, x1:22,y1:30, x2:12,y2:36, x3:0,y3:26 }],
  // 13: Pointy top — sharp lobe peaks
  [{ x0:0,y0:0, x1:8,y1:0, x2:18,y2:6, x3:18,y3:20 }, { x0:18,y0:20, x1:18,y1:30, x2:0,y2:34, x3:0,y3:22 }],
  // 14: Squat — very wide, very short
  [{ x0:0,y0:0, x1:14,y1:0, x2:26,y2:4, x3:26,y3:12 }, { x0:26,y0:12, x1:26,y1:22, x2:6,y2:24, x3:0,y3:16 }],
  // 15: Elegant — gentle S-curves
  [{ x0:0,y0:0, x1:6,y1:0, x2:18,y2:8, x3:18,y3:22 }, { x0:18,y0:22, x1:18,y1:34, x2:8,y2:36, x3:0,y3:26 }],
  // 16: Bold — thick and full
  [{ x0:0,y0:0, x1:12,y1:0, x2:22,y2:10, x3:22,y3:20 }, { x0:22,y0:20, x1:22,y1:34, x2:4,y2:36, x3:0,y3:22 }],
  // 17: Pinched waist — narrow middle
  [{ x0:0,y0:0, x1:6,y1:0, x2:20,y2:4, x3:20,y3:20 }, { x0:20,y0:20, x1:20,y1:36, x2:4,y2:36, x3:0,y3:24 }],
  // 18: Wide base — extra flat bottom
  [{ x0:0,y0:0, x1:16,y1:0, x2:22,y2:6, x3:22,y3:16 }, { x0:22,y0:16, x1:22,y1:30, x2:4,y2:34, x3:0,y3:24 }],
  // 19: Teardrop heart — rounded lobes, narrow bottom
  [{ x0:0,y0:0, x1:4,y1:0, x2:20,y2:12, x3:20,y3:22 }, { x0:20,y0:22, x1:20,y1:34, x2:6,y2:36, x3:0,y3:26 }],
  // 20: Extra large — big and bold
  [{ x0:0,y0:0, x1:14,y1:0, x2:26,y2:12, x3:26,y3:24 }, { x0:26,y0:24, x1:26,y1:40, x2:6,y2:42, x3:0,y3:28 }],
];

function buildHeartShape(fontSize, style = 1) {
  const idx = Math.max(0, Math.min(HEART_VARIANTS.length - 1, style - 1));
  const rightCurves = HEART_VARIANTS[idx];
  const s = fontSize / 72;
  const seg = 16;
  const points = [];

  // Right half (bottom to top)
  for (const c of rightCurves) {
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const u = 1 - t;
      const x = u*u*u*c.x0 + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x3;
      const y = u*u*u*c.y0 + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y3;
      points.push([x * s, y * s]);
    }
  }

  // Left half (top to bottom, mirrored X)
  for (let i = rightCurves.length - 1; i >= 0; i--) {
    const c = rightCurves[i];
    for (let k = seg; k >= 0; k--) {
      const t = k / seg;
      const u = 1 - t;
      const x = u*u*u*c.x0 + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x3;
      const y = u*u*u*c.y0 + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y3;
      points.push([-x * s, y * s]);
    }
  }

  // Remove duplicate points at seams
  const cleaned = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    if (Math.abs(points[i][0] - prev[0]) > 0.01 || Math.abs(points[i][1] - prev[1]) > 0.01) {
      cleaned.push(points[i]);
    }
  }

  const area = computeSignedArea(cleaned);
  if (area < 0) cleaned.reverse();

  const shape = pointsToGeom2(cleaned);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of cleaned) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };

  dbg(`  heart #${style}: ${bounds.width.toFixed(1)} x ${bounds.height.toFixed(1)}`);
  return { shape, bounds };
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function computeSignedArea(points) {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const j = (i + 1) % n;
    a += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  return a / 2;
}

function bboxInside(inner, outer) {
  return inner.minX > outer.minX && inner.maxX < outer.maxX &&
         inner.minY > outer.minY && inner.maxY < outer.maxY;
}
