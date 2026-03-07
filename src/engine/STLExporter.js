import * as THREE from 'three';
import { STLExporter as ThreeSTLExporter } from 'three/addons/exporters/STLExporter.js';

const exporter = new ThreeSTLExporter();

/**
 * Clone the group and rotate from Three.js Y-up to slicer Z-up,
 * so the base plate sits flat on the slicer bed.
 */
function prepareForSlicer(group) {
  const clone = group.clone(true);
  clone.rotateX(Math.PI / 2);
  clone.updateMatrixWorld(true);
  return clone;
}

/**
 * Export a THREE.Group as a binary STL file and trigger browser download.
 *
 * @param {THREE.Group} group - The 3D model to export
 * @param {string} [filename='dual-letter-illusion.stl'] - Download filename
 */
export function exportToSTL(group, filename = 'dual-letter-illusion.stl') {
  const exportGroup = prepareForSlicer(group);
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
 * Useful for e-commerce: send to server or attach to order.
 *
 * @param {THREE.Group} group
 * @returns {Blob}
 */
export function exportToSTLBlob(group) {
  const exportGroup = prepareForSlicer(group);
  const stlData = exporter.parse(exportGroup, { binary: true });
  return new Blob([stlData], { type: 'application/octet-stream' });
}
