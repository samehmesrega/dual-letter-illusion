import { STLExporter as ThreeSTLExporter } from 'three/addons/exporters/STLExporter.js';

const exporter = new ThreeSTLExporter();

/**
 * Export a THREE.Group as a binary STL file and trigger browser download.
 *
 * @param {THREE.Group} group - The 3D model to export
 * @param {string} [filename='dual-letter-illusion.stl'] - Download filename
 */
export function exportToSTL(group, filename = 'dual-letter-illusion.stl') {
  const stlData = exporter.parse(group, { binary: true });
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
  const stlData = exporter.parse(group, { binary: true });
  return new Blob([stlData], { type: 'application/octet-stream' });
}
