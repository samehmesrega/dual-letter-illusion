import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Extrude an array of THREE.Shape (from a single glyph) into a 3D mesh.
 *
 * @param {THREE.Shape[]} shapes - Shapes from glyphToShapes()
 * @param {number} depth - Extrusion depth
 * @returns {THREE.Mesh}
 */
export function extrudeLetter(shapes, depth = 100) {
  if (!shapes || shapes.length === 0) return null;

  const extrudeSettings = {
    depth: depth,
    bevelEnabled: false,
    curveSegments: 6
  };

  const geometries = [];
  for (const shape of shapes) {
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometries.push(geo);
  }

  let geometry;
  if (geometries.length === 1) {
    geometry = geometries[0];
  } else {
    geometry = mergeGeometries(geometries);
    // Dispose individual geometries after merge
    for (const geo of geometries) geo.dispose();
  }

  const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
  return new THREE.Mesh(geometry, material);
}

/**
 * Compute the 2D bounding box of an array of shapes (before extrusion).
 * Used to determine appropriate extrusion depth.
 *
 * @param {THREE.Shape[]} shapes
 * @returns {{ width: number, height: number }}
 */
export function computeShapesBounds(shapes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    const points = shape.getPoints();
    for (const pt of points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
    minX, minY, maxX, maxY
  };
}
