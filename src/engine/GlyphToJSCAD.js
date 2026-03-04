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
    return buildHeartShape(fontSize);
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

// ── Heart shape builder ──────────────────────────────────────────────────────

function buildHeartShape(fontSize) {
  // Rounded heart with flat bottom for solid base connection.
  // Built from two cubic bezier halves (right side mirrored to left).
  const s = fontSize / 72; // scale factor
  const seg = 16; // segments per bezier

  // Right half bezier curves (bottom-center → right lobe top → top-center dip)
  // Then mirrored for left half. Bottom is flat, not pointy.
  const rightCurves = [
    // Bottom flat segment → right side
    { x0: 0, y0: 0, x1: 8, y1: 0, x2: 16, y2: 8, x3: 16, y3: 18 },
    // Right lobe → top center
    { x0: 16, y0: 18, x1: 16, y1: 30, x2: 4, y2: 32, x3: 0, y3: 22 },
  ];

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

  // Ensure CCW winding
  const area = computeSignedArea(cleaned);
  if (area < 0) cleaned.reverse();

  const shape = pointsToGeom2(cleaned);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of cleaned) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };

  dbg(`  heart shape: ${bounds.width.toFixed(1)} x ${bounds.height.toFixed(1)}`);
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
