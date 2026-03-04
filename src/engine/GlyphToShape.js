import * as THREE from 'three';

const glyphDebug = [];
export function getGlyphDebugLog() { return glyphDebug.slice(); }
function dbg(msg) { glyphDebug.push(msg); console.log(msg); }

/**
 * Convert opentype.js glyph to THREE.Shape[] ready for extrusion.
 *
 * Hole detection: bbox containment (even-odd nesting depth).
 * Winding:  EarCut requires outer = CCW (+area), holes = CW (-area).
 *           After the Y-flip we enforce this explicitly.
 */
export function glyphToShapes(font, char, fontSize = 72) {
  glyphDebug.length = 0;
  dbg(`[GlyphToShape] '${char}' size=${fontSize}`);

  const glyphPath = font.getPath(char, 0, 0, fontSize);
  const shapePath = new THREE.ShapePath();

  for (const cmd of glyphPath.commands) {
    switch (cmd.type) {
      case 'M': shapePath.moveTo(cmd.x, -cmd.y); break;
      case 'L': shapePath.lineTo(cmd.x, -cmd.y); break;
      case 'C': shapePath.bezierCurveTo(cmd.x1,-cmd.y1, cmd.x2,-cmd.y2, cmd.x,-cmd.y); break;
      case 'Q': shapePath.quadraticCurveTo(cmd.x1,-cmd.y1, cmd.x,-cmd.y); break;
      case 'Z': break;
    }
  }

  const subPaths = shapePath.subPaths;
  if (!subPaths || subPaths.length === 0) return [];

  // Sample each subpath into points for analysis + shape building
  const RES = 8;
  const contours = [];
  for (let idx = 0; idx < subPaths.length; idx++) {
    const pts = subPaths[idx].getPoints(RES);
    if (pts.length < 3) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }

    const signedArea = computeSignedArea(pts);
    if (Math.abs(signedArea) < 0.01) continue;

    dbg(`  contour[${idx}]: area=${signedArea.toFixed(1)}, bbox=(${minX.toFixed(1)},${minY.toFixed(1)})→(${maxX.toFixed(1)},${maxY.toFixed(1)}), ${pts.length}pts`);
    contours.push({ index: idx, pts, signedArea, absArea: Math.abs(signedArea), minX, minY, maxX, maxY });
  }

  if (contours.length === 0) return [];

  contours.sort((a, b) => b.absArea - a.absArea);

  // Nesting depth via bbox containment → even = outer, odd = hole
  for (const c of contours) {
    let depth = 0;
    for (const other of contours) {
      if (other !== c && bboxInside(c, other)) depth++;
    }
    c.depth = depth;
    c.isHole = (depth % 2) === 1;
    dbg(`  contour[${c.index}]: depth=${depth}, isHole=${c.isHole}`);
  }

  const outers = contours.filter(c => !c.isHole);
  const holes  = contours.filter(c =>  c.isHole);
  dbg(`  ${outers.length} outers + ${holes.length} holes`);

  // Build THREE.Shape for each outer — enforce CCW winding for EarCut
  const entries = outers.map(outer => {
    const pts = outer.signedArea < 0
      ? outer.pts.slice().reverse()   // CW → CCW
      : outer.pts.slice();
    if (outer.signedArea < 0) dbg(`  outer[${outer.index}] reversed → CCW`);
    return { shape: new THREE.Shape(pts), outer };
  });

  // Assign holes — enforce CW winding for EarCut
  for (const hole of holes) {
    // FIX: was `hole.reverse()` (wrong — reverses the object, not the array)
    const pts = hole.signedArea > 0
      ? hole.pts.slice().reverse()    // CCW → CW
      : hole.pts.slice();
    if (hole.signedArea > 0) dbg(`  hole[${hole.index}] reversed → CW`);

    let bestIdx = -1, bestArea = Infinity;
    for (let i = 0; i < entries.length; i++) {
      const o = entries[i].outer;
      if (o.depth === hole.depth - 1 && bboxInside(hole, o) && o.absArea < bestArea) {
        bestArea = o.absArea;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      entries[bestIdx].shape.holes.push(new THREE.Path(pts));
      dbg(`  hole[${hole.index}] → outer[${entries[bestIdx].outer.index}]`);
    } else {
      dbg(`  hole[${hole.index}]: no parent found`);
    }
  }

  dbg(`  RESULT: ${entries.length} shapes, holes:[${entries.map(e => e.shape.holes.length).join(',')}]`);
  return entries.map(e => e.shape);
}

function bboxInside(inner, outer) {
  return inner.minX > outer.minX && inner.maxX < outer.maxX &&
         inner.minY > outer.minY && inner.maxY < outer.maxY;
}

function computeSignedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}
