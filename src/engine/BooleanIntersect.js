import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const evaluator = new Evaluator();
evaluator.useGroups = false;

/**
 * Perform boolean intersection of two letter meshes.
 * Letter A at 45° around Y, Letter B at 135° around Y.
 *
 * FIX: Rotations are BAKED into geometry vertices before CSG.
 * This avoids the world-space/local-space mismatch that caused
 * the result bounding box to be sqrt(2) times too large.
 */
export function intersectLetters(meshA, meshB) {
  // Bake rotations directly into geometry vertices
  const geoA = meshA.geometry.clone();
  geoA.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 4));

  const geoB = meshB.geometry.clone();
  geoB.applyMatrix4(new THREE.Matrix4().makeRotationY(3 * Math.PI / 4));

  const brushA = new Brush(geoA, meshA.material);
  const brushB = new Brush(geoB, meshB.material);

  // Identity transforms — rotations already in geometry
  brushA.updateMatrixWorld(true);
  brushB.updateMatrixWorld(true);

  const resultBrush = evaluator.evaluate(brushA, brushB, INTERSECTION);

  geoA.dispose();
  geoB.dispose();

  const result = new THREE.Mesh(resultBrush.geometry, meshA.material);
  result.geometry = cleanGeometry(result.geometry);
  return result;
}

/**
 * Merge near-duplicate vertices, remove degenerate (zero-area) triangles,
 * recompute vertex normals.
 */
function cleanGeometry(geometry) {
  let geo = mergeVertices(geometry, 0.001);

  const pos   = geo.attributes.position;
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
  const keep = [];
  let removed = 0;

  for (let i = 0; i < triCount; i++) {
    const ia = index ? index.getX(i*3)   : i*3;
    const ib = index ? index.getX(i*3+1) : i*3+1;
    const ic = index ? index.getX(i*3+2) : i*3+2;
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    cross.crossVectors(ab.subVectors(b,a), ac.subVectors(c,a));
    if (cross.lengthSq() > 1e-8) keep.push(ia, ib, ic);
    else removed++;
  }

  if (removed > 0) {
    console.log(`[cleanGeometry] removed ${removed} degenerate tris`);
    geo.setIndex(keep);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Center a mesh's geometry so its bounding box center is at origin.
 */
export function centerMeshAtOrigin(mesh) {
  mesh.geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  mesh.geometry.boundingBox.getCenter(center);
  mesh.geometry.translate(-center.x, -center.y, -center.z);
}
