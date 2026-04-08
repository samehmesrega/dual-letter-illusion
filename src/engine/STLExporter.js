import * as THREE from 'three';
import { STLExporter as ThreeSTLExporter } from 'three/addons/exporters/STLExporter.js';

const exporter = new ThreeSTLExporter();

// Target physical dimensions (mm) — must match server.js scaleSTL targets
const TARGET_X = 192;
const TARGET_Y_NO_INSCR = 42;
const TARGET_Y_INSCR = 48;
const TARGET_Z = 37;

/**
 * Clone the group, rotate from Three.js Y-up to slicer Z-up,
 * and scale to target physical dimensions (mm) so the exported STL
 * is print-ready without server-side scaling.
 */
function prepareForSlicer(group, hasInscription = false) {
  const clone = group.clone(true);
  clone.rotateX(Math.PI / 2);
  clone.updateMatrixWorld(true);

  // Compute bounding box in slicer orientation
  const bbox = new THREE.Box3().setFromObject(clone);
  const size = bbox.getSize(new THREE.Vector3());
  if (size.x > 0 && size.y > 0 && size.z > 0) {
    const targetY = hasInscription ? TARGET_Y_INSCR : TARGET_Y_NO_INSCR;
    const sx = TARGET_X / size.x;
    const sy = targetY / size.y;
    const sz = TARGET_Z / size.z;
    clone.scale.set(sx, sy, sz);
    clone.updateMatrixWorld(true);
  }

  return clone;
}

/**
 * Export a THREE.Group as a binary STL file and trigger browser download.
 * STL is scaled to target mm dimensions for direct printing.
 *
 * @param {THREE.Group} group - The 3D model to export
 * @param {string} [filename='dual-letter-illusion.stl'] - Download filename
 * @param {boolean} [hasInscription=false] - Whether model has inscription text
 */
export function exportToSTL(group, filename = 'dual-letter-illusion.stl', hasInscription = false) {
  const exportGroup = prepareForSlicer(group, hasInscription);
  const stlData = exporter.parse(exportGroup, { binary: true });
  const blob = new Blob([stlData], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export a THREE.Group as a binary STL Blob without triggering download.
 * STL is scaled to target mm dimensions.
 *
 * @param {THREE.Group} group
 * @param {boolean} [hasInscription=false] - Whether model has inscription text
 * @returns {Blob}
 */
export function exportToSTLBlob(group, hasInscription = false) {
  const exportGroup = prepareForSlicer(group, hasInscription);
  const stlData = exporter.parse(exportGroup, { binary: true });
  return new Blob([stlData], { type: 'application/octet-stream' });
}
