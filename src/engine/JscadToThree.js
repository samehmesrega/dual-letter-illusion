import * as THREE from 'three';
import { geometries } from '@jscad/modeling';

/**
 * Convert a JSCAD geom3 into a Three.js BufferGeometry.
 * Uses JSCAD's own polygon normals for correct flat-face shading.
 */
export function jscadToThree(jscadGeom) {
  const polygons = geometries.geom3.toPolygons(jscadGeom);

  const verts = [];
  const norms = [];

  for (const poly of polygons) {
    const pts = poly.vertices;
    if (pts.length < 3) continue;

    // Use JSCAD's polygon plane normal (guaranteed correct winding)
    let nx, ny, nz;
    if (poly.plane && poly.plane.length >= 3) {
      nx = poly.plane[0]; ny = poly.plane[1]; nz = poly.plane[2];
    } else {
      // Fallback: compute from first 3 vertices
      const ux = pts[1][0]-pts[0][0], uy = pts[1][1]-pts[0][1], uz = pts[1][2]-pts[0][2];
      const vx = pts[2][0]-pts[0][0], vy = pts[2][1]-pts[0][1], vz = pts[2][2]-pts[0][2];
      const cx = uy*vz - uz*vy, cy = uz*vx - ux*vz, cz = ux*vy - uy*vx;
      const len = Math.sqrt(cx*cx + cy*cy + cz*cz) || 1;
      nx = cx/len; ny = cy/len; nz = cz/len;
    }

    // Fan triangulation — same normal for every vertex in this polygon
    for (let i = 1; i < pts.length - 1; i++) {
      verts.push(pts[0][0], pts[0][1], pts[0][2]);
      verts.push(pts[i][0], pts[i][1], pts[i][2]);
      verts.push(pts[i+1][0], pts[i+1][1], pts[i+1][2]);
      norms.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(norms), 3));
  return geo;
}
