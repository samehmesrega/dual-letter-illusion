import * as THREE from 'three';
import { booleans, extrusions, primitives, transforms, geometries } from '@jscad/modeling';
import { loadFont } from './FontLoader.js';
import { glyphToJSCAD, textToJSCAD, getGlyphDebugLog } from './GlyphToJSCAD.js';
import { jscadToThree } from './JscadToThree.js';

/**
 * Build a rounded-corner base plate via JSCAD (same pipeline as letters).
 * JSCAD roundedRectangle → extrudeLinear → jscadToThree.
 * Guarantees a solid, watertight mesh — bypasses Three.js cap triangulation.
 */

export const debugLog = [];
function dbg(msg) { debugLog.push(msg); console.log(msg); }

export async function buildAmbigram(options) {
  const {
    textA, textB, fontUrl,
    fontSize        = 72,
    spacing         = 8,
    baseHeight      = 2,
    basePadding     = 10,
    cornerRadius    = 0,
    heartStyle      = 1,
    inscriptionText = '',
    inscriptionFontUrl = null,
    orderNumber = '',
    padBefore = 0,
    padAfter  = 0
  } = options;

  debugLog.length = 0;
  dbg(`=== BUILD START: "${textA}" + "${textB}" | font: ${fontUrl} | size: ${fontSize} | pad: ${padBefore}/${padAfter} ===`);

  const font = await loadFont(fontUrl);

  // Set heart style for glyph builder
  glyphToJSCAD._heartStyle = heartStyle;

  const maxLen = Math.max(textA.length, textB.length);
  const a = textA.toUpperCase().padEnd(maxLen, '\u2665');
  const b = textB.toUpperCase().padEnd(maxLen, '\u2665');

  // Slot width: approximate width of one letter position
  const slotWidth = fontSize * 0.7 + spacing;

  const group = new THREE.Group();
  let currentX = padBefore * slotWidth, maxHeight = 0, maxDepth = 0;
  const letterMeshes = [];  // track meshes + their bbox.min.y for baseline alignment

  for (let i = 0; i < maxLen; i++) {
    const charA = a[i];
    const charB = b[i];
    dbg(`\n--- PAIR ${i}: '${charA}' + '${charB}' ---`);

    if (charA === ' ' && charB === ' ') {
      currentX += fontSize * 0.5;
      continue;
    }

    // Glyph → JSCAD geom2
    const resultA = glyphToJSCAD(font, charA, fontSize);
    for (const line of getGlyphDebugLog()) dbg('  [A] ' + line);

    const resultB = glyphToJSCAD(font, charB, fontSize);
    for (const line of getGlyphDebugLog()) dbg('  [B] ' + line);

    if (!resultA || !resultB) {
      dbg('  SKIP — no shape');
      currentX += fontSize * 0.5;
      continue;
    }

    const { shape: shapeA, bounds: boundsA } = resultA;
    const { shape: shapeB, bounds: boundsB } = resultB;

    dbg(`  boundsA: ${boundsA.width.toFixed(1)}x${boundsA.height.toFixed(1)}`);
    dbg(`  boundsB: ${boundsB.width.toFixed(1)}x${boundsB.height.toFixed(1)}`);

    // Extrusion depth = 3× largest glyph dimension
    const maxDim = Math.max(boundsA.width, boundsA.height, boundsB.width, boundsB.height);
    const extrudeDepth = maxDim * 3;
    dbg(`  extrudeDepth: ${extrudeDepth.toFixed(1)}`);

    // Center each geom2 at XY origin before extrusion
    const cxA = (boundsA.minX + boundsA.maxX) / 2;
    const cyA = (boundsA.minY + boundsA.maxY) / 2;
    const cxB = (boundsB.minX + boundsB.maxX) / 2;
    const cyB = (boundsB.minY + boundsB.maxY) / 2;

    const centeredA = transforms.translate([-cxA, -cyA, 0], shapeA);
    const centeredB = transforms.translate([-cxB, -cyB, 0], shapeB);

    // Extrude in Z direction (0 → extrudeDepth)
    const extA = extrusions.extrudeLinear({ height: extrudeDepth }, centeredA);
    const extB = extrusions.extrudeLinear({ height: extrudeDepth }, centeredB);

    // Center in Z: shift from [0, depth] to [-depth/2, +depth/2]
    const halfD = extrudeDepth / 2;
    const centExtA = transforms.translate([0, 0, -halfD], extA);
    const centExtB = transforms.translate([0, 0, -halfD], extB);

    // Rotate: A at -45° (face toward -X+Z, green-arrow side), B at +45° (face toward +X+Z, yellow-arrow side)
    // These two directions are perpendicular (dot=0), so CSG intersection works correctly.
    const rotA = transforms.rotateY(-Math.PI / 4, centExtA);
    const rotB = transforms.rotateY( Math.PI / 4, centExtB);

    // CSG intersection
    let jscadResult;
    try {
      jscadResult = booleans.intersect(rotA, rotB);
    } catch (err) {
      dbg(`  CSG FAILED: ${err.message}`);
      currentX += fontSize * 0.5;
      continue;
    }

    // Validate result
    const polys = geometries.geom3.toPolygons(jscadResult);
    if (!polys || polys.length === 0) {
      dbg('  CSG empty result');
      currentX += fontSize * 0.5;
      continue;
    }
    dbg(`  CSG result: ${polys.length} polygons`);

    // Convert to Three.js geometry
    const geo = jscadToThree(jscadResult);
    geo.computeBoundingBox();
    const bbox = geo.boundingBox;
    const rW = bbox.max.x - bbox.min.x;
    const rH = bbox.max.y - bbox.min.y;
    const rD = bbox.max.z - bbox.min.z;
    dbg(`  size: ${rW.toFixed(1)} x ${rH.toFixed(1)} x ${rD.toFixed(1)}`);

    if (rH < 0.1) {
      dbg('  SKIP — zero height result');
      currentX += fontSize * 0.5;
      continue;
    }

    // Place side by side along X axis
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xe8735a,   // warm terracotta — same tone as base for a unified print look
      roughness: 0.45,
      metalness: 0.0,
      side: THREE.DoubleSide
    }));

    mesh.position.x = currentX - bbox.min.x;
    currentX += rW + spacing;
    maxHeight = Math.max(maxHeight, rH);
    maxDepth  = Math.max(maxDepth,  rD);

    mesh.name = `pair_${charA}_${charB}`;
    letterMeshes.push({ mesh, bboxMinY: bbox.min.y });
    group.add(mesh);
  }

  // Align all letters so their bottom touches the base plate top (-maxHeight/2)
  for (const { mesh, bboxMinY } of letterMeshes) {
    mesh.position.y = -maxHeight / 2 - bboxMinY;
  }

  // Add empty slots after letters
  currentX += padAfter * slotWidth;

  // ── Inscription (flat text on base, readable from above) ──
  let inscrDepthExtra = 0;   // extra depth the base plate needs in +Z
  const inscrExtrudeH = 2;   // 2 mm raised above base surface
  const lettersCenterX = (currentX - spacing) / 2;
  const inscrTrimmed = inscriptionText.trim();

  if (group.children.length > 0 && inscrTrimmed) {
    dbg(`\n--- INSCRIPTION: "${inscrTrimmed}" ---`);

    // Load separate inscription font if provided, otherwise use main font
    const inscrFont = inscriptionFontUrl ? await loadFont(inscriptionFontUrl) : font;

    // Compute expected base width so inscription scales relative to it
    const lettersW = currentX - spacing;
    const expectedBaseW = Math.max(lettersW, 0) + basePadding * 2;

    // Inscription width: 30%-80% of base width, large font always
    const maxInscrW = expectedBaseW * 0.8;
    const minInscrW = expectedBaseW * 0.3;
    const refWidth = inscrFont.getAdvanceWidth(inscrTrimmed, 72);
    let inscrFontSize = refWidth > 0 ? 72 * maxInscrW / refWidth : 20;
    // Ensure text is at least 30% of base width
    if (refWidth > 0) {
      const actualW = refWidth * (inscrFontSize / 72);
      if (actualW < minInscrW) inscrFontSize = 72 * minInscrW / refWidth;
    }
    dbg(`  expectedBaseW: ${expectedBaseW.toFixed(1)}, maxInscrW: ${maxInscrW.toFixed(1)}, inscrFontSize: ${inscrFontSize.toFixed(1)}`);

    // Full-string rendering: handles Arabic shaping, RTL, ligatures, kerning
    const result = textToJSCAD(inscrFont, inscrTrimmed, inscrFontSize);
    getGlyphDebugLog(); // clear log

    if (result) {
      const { shape, bounds } = result;
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const centered = transforms.translate([-cx, -cy, 0], shape);

      // Extrude 2 mm in Z, convert to Three.js
      const extruded = extrusions.extrudeLinear({ height: inscrExtrudeH }, centered);
      const geo = jscadToThree(extruded);
      // Lay flat: X=text dir, Y=extrusion (up), Z=-glyph Y
      geo.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0xe8735a, roughness: 0.45, metalness: 0.0, side: THREE.DoubleSide
      }));

      geo.computeBoundingBox();
      const bbox = geo.boundingBox;
      const inscrW = bbox.max.x - bbox.min.x;
      const inscrD = bbox.max.z - bbox.min.z;
      dbg(`  inscription size: ${inscrW.toFixed(1)} x ${inscrD.toFixed(1)}`);

      // Center horizontally, same as letters
      mesh.position.x = lettersCenterX - inscrW / 2 - bbox.min.x;
      // 5 mm gap between inscription and letters, 5 mm between inscription and base edge
      const gapToLetters = 5;
      const gapToEdge = 5;
      mesh.position.z = maxDepth / 2 + gapToLetters - bbox.min.z;
      // Bottom sits on base plate top surface
      mesh.position.y = -maxHeight / 2 - bbox.min.y;

      inscrDepthExtra = gapToLetters + inscrD + gapToEdge;
      mesh.name = 'inscription';
      group.add(mesh);
    }
  }

  // ── Base plate ──
  if (group.children.length > 0) {
    const lettersW = currentX - spacing;
    const totalW = Math.max(lettersW, 0) + basePadding * 2;
    // Back side: basePadding. Front side (+Z): basePadding OR inscription area (whichever applies)
    const frontPad = inscrDepthExtra > 0 ? inscrDepthExtra : basePadding;
    const totalD = maxDepth + basePadding + frontPad;

    // Z-center shifts when front extends more than back
    const baseZCenter = (frontPad - basePadding) / 2;

    const r = Math.min(cornerRadius, totalW / 2, totalD / 2);

    // Build base as JSCAD shape (XY plane, extruded along Z)
    const basePlate2d = r > 0
      ? primitives.roundedRectangle({ size: [totalW, totalD], roundRadius: r, segments: 32 })
      : primitives.rectangle({ size: [totalW, totalD] });
    let basePlate3d = extrusions.extrudeLinear({ height: baseHeight }, basePlate2d);
    basePlate3d = transforms.translate([0, 0, -baseHeight / 2], basePlate3d);

    // ── Order number: CSG subtract from base ──
    const orderTrimmed = (orderNumber || '').toString().trim();
    if (orderTrimmed) {
      dbg(`\n--- ORDER NUMBER: "${orderTrimmed}" ---`);
      const orderFont = inscriptionFontUrl ? await loadFont(inscriptionFontUrl) : font;
      const orderFontSize = 10;
      const orderExtrudeH = 1; // 1 mm engrave depth

      const orderResult = textToJSCAD(orderFont, orderTrimmed, orderFontSize);
      getGlyphDebugLog(); // clear log

      if (orderResult) {
        const { shape, bounds } = orderResult;
        const textW = bounds.maxX - bounds.minX;
        // Dynamic target width: fewer chars → bigger (up to 150mm), more chars → smaller (min 70mm)
        const minW = 70;   // 7 cm
        const maxW = 150;  // 15 cm
        const refLen = 6;  // text ≤ 6 chars gets max width
        const charCount = orderTrimmed.length;
        const targetW = charCount <= refLen
          ? maxW
          : Math.max(minW, maxW - (charCount - refLen) * ((maxW - minW) / 14));
        dbg(`  orderNum chars=${charCount}, targetW=${targetW.toFixed(0)}mm`);
        const scaleFactor = textW > 0 ? targetW / textW : 1;
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        // Center text, scale to 4cm width, mirror X so it reads correctly when flipped
        let orderShape = transforms.translate([-cx, -cy, 0], shape);
        orderShape = transforms.scale([scaleFactor, scaleFactor, 1], orderShape);
        orderShape = transforms.mirrorX(orderShape);
        // Extrude and position at bottom of base plate (Z = -baseHeight/2)
        let orderSolid = extrusions.extrudeLinear({ height: orderExtrudeH }, orderShape);
        orderSolid = transforms.translate([0, 0, -baseHeight / 2], orderSolid);

        try {
          basePlate3d = booleans.subtract(basePlate3d, orderSolid);
          dbg(`  order number engraved into base bottom`);
        } catch (e) {
          dbg(`  order number CSG subtract failed: ${e.message}`);
        }
      }
    }

    // Convert JSCAD base to Three.js geometry
    const baseGeo = jscadToThree(basePlate3d);
    // JSCAD XY+Z → Three.js XZ+Y: rotate -90° on X
    baseGeo.rotateX(-Math.PI / 2);

    const base = new THREE.Mesh(
      baseGeo,
      new THREE.MeshStandardMaterial({ color: 0xe8735a, roughness: 0.45, metalness: 0.0, side: THREE.DoubleSide })
    );

    // Top surface touches letter bottoms
    base.position.x = lettersCenterX;
    base.position.y = -maxHeight / 2 - baseHeight / 2;
    base.position.z = baseZCenter;
    base.name = 'base_plate';
    group.add(base);
  }

  // Center the whole group
  const gBBox = new THREE.Box3().setFromObject(group);
  const gCenter = new THREE.Vector3();
  gBBox.getCenter(gCenter);
  group.position.set(-gCenter.x, -gCenter.y, -gCenter.z);

  dbg(`\n=== BUILD DONE: ${group.children.length} children ===`);
  return group;
}
