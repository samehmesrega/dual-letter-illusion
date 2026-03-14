import './styles/main.css';
import * as THREE from 'three';
import { createInputPanel } from './ui/InputPanel.js';
import { createPreviewPanel } from './ui/PreviewPanel.js';
import { buildAmbigram, debugLog } from './engine/AmbigramBuilder.js';
import { exportToSTL, exportToSTLBlob } from './engine/STLExporter.js';
import { processBatch } from './engine/BatchProcessor.js';
import { FONT_FILE, INSCRIPTION_FONT } from './fonts/curated-fonts.js';

// App state
const state = {
  textA: '',
  textB: '',
  fontFile:      FONT_FILE,
  fontSize:      72,
  cornerRadius:  5,
  baseThickness: 2,
  heartStyle:    9,
  inscriptionText: '',
  orderNumber: '',
  padBefore: 0,
  padAfter: 0,
  currentModel:  null
};

// Initialize UI
const inputPanel = createInputPanel(document.getElementById('input-panel'), {
  onChange: handleInputChange,
  onGenerate: handleGenerate,
  onDownload: handleDownload,
  onDownloadGcode: handleDownloadGcode,
  onWireframeToggle: handleWireframeToggle,
  onBatchGenerate: handleBatchGenerate,
  onCopyDebug: handleCopyDebug
});

const previewPanel = createPreviewPanel(document.getElementById('preview-panel'));

// Debounced auto-generation
let debounceTimer;
function handleInputChange(newState) {
  Object.assign(state, newState);
  clearTimeout(debounceTimer);
  if (state.textA && state.textB) {
    debounceTimer = setTimeout(() => handleGenerate(), 800);
  }
}

async function handleGenerate() {
  if (!state.textA || !state.textB) {
    previewPanel.showError('Please enter text on both sides.');
    return;
  }

  inputPanel.setLoading(true);
  inputPanel.enableDownload(false);
  previewPanel.showLoading(true);
  previewPanel.clearError();

  try {
    const fontUrl = `/fonts/${state.fontFile}`;
    const model = await buildAmbigram({
      textA:        state.textA,
      textB:        state.textB,
      fontUrl,
      fontSize:     state.fontSize,
      cornerRadius: state.cornerRadius,
      baseHeight:   state.baseThickness,
      heartStyle:   state.heartStyle,
      inscriptionText: state.inscriptionText,
      inscriptionFontUrl: `/fonts/${INSCRIPTION_FONT}`,
      orderNumber: state.orderNumber,
      padBefore: state.padBefore,
      padAfter: state.padAfter
    });

    state.currentModel = model;
    previewPanel.setModel(model);
    inputPanel.enableDownload(true);
  } catch (err) {
    console.error('Generation failed:', err);
    previewPanel.showError('Failed to generate model. Try different letters or font.');
  }

  inputPanel.setLoading(false);
  previewPanel.showLoading(false);
}

function handleDownload() {
  if (!state.currentModel) return;
  const safe = (s) => s.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
  const orderPart = state.orderNumber ? `${safe(state.orderNumber)}-` : '';
  const filename = `DN-${orderPart}${safe(state.textA)}-${safe(state.textB)}.stl`;
  exportToSTL(state.currentModel, filename);
}

async function handleDownloadGcode(profile) {
  if (!state.currentModel) return;

  const safe = (s) => s.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
  const orderPart = state.orderNumber ? `${safe(state.orderNumber)}-` : '';
  const stlFilename = `DN-${orderPart}${safe(state.textA)}-${safe(state.textB)}.stl`;

  // Get STL blob
  const stlBlob = exportToSTLBlob(state.currentModel);

  // Send to slicer API
  const form = new FormData();
  form.append('stl', stlBlob, stlFilename);
  form.append('profile', profile || 'default');
  form.append('filename', stlFilename);
  if (state.inscriptionText) form.append('hasInscription', '1');

  inputPanel.setLoading(true);
  try {
    const res = await fetch('/api/slice', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.details || 'Slicing failed');
    }
    const gcodeBlob = await res.blob();
    const url = URL.createObjectURL(gcodeBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = stlFilename.replace(/\.stl$/i, '.gcode');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('G-code download failed:', err);
    previewPanel.showError('G-code slicing failed: ' + err.message);
  }
  inputPanel.setLoading(false);
}

async function handleBatchGenerate(sheetUrl) {
  if (!sheetUrl) {
    previewPanel.showError('Please paste a Google Sheets URL.');
    return;
  }

  inputPanel.setBatchLoading(true);
  previewPanel.clearError();

  try {
    await processBatch(sheetUrl, {
      fontUrl:            `/fonts/${state.fontFile}`,
      fontSize:           state.fontSize,
      cornerRadius:       state.cornerRadius,
      baseThickness:      state.baseThickness,
      heartStyle:         state.heartStyle,
      inscriptionFontUrl: `/fonts/${INSCRIPTION_FONT}`
    }, (current, total, status) => {
      inputPanel.setBatchProgress(current, total, status);
    });
  } catch (err) {
    console.error('Batch failed:', err);
    previewPanel.showError(err.message || 'Batch generation failed.');
  }

  inputPanel.setBatchLoading(false);
}

function handleWireframeToggle(on) {
  if (!state.currentModel) return;
  state.currentModel.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.wireframe = on;
    }
  });
}

function handleCopyDebug(btn) {
  let output = debugLog.join('\n');

  if (state.currentModel) {
    output += '\n\n=== CURRENT MODEL MESHES ===';
    state.currentModel.traverse(child => {
      if (!child.isMesh) return;
      const geo = child.geometry;
      const pos = geo.attributes.position;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const size = new THREE.Vector3();
      bb.getSize(size);
      output += `\nMesh "${child.name}": ${pos.count} verts, ${geo.index ? geo.index.count / 3 : pos.count / 3} tris`;
      output += `\n  bbox: (${bb.min.x.toFixed(1)},${bb.min.y.toFixed(1)},${bb.min.z.toFixed(1)}) → (${bb.max.x.toFixed(1)},${bb.max.y.toFixed(1)},${bb.max.z.toFixed(1)})`;
      output += `\n  size: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`;
      output += `\n  material.side: ${child.material.side === 2 ? 'DoubleSide' : child.material.side === 0 ? 'FrontSide' : 'BackSide'}`;
    });
  }

  navigator.clipboard.writeText(output).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Debug'; }, 1500);
  });
}

// --- Mobile tab toggle ---
function setupMobileTabs() {
  if (window.innerWidth > 768) return;

  const main = document.getElementById('app-main');
  const inputPanel = document.getElementById('input-panel');
  const previewPanel = document.getElementById('preview-panel');

  const tabBar = document.createElement('div');
  tabBar.className = 'mobile-tabs';
  tabBar.innerHTML = `
    <button class="mobile-tab active" data-tab="controls">Controls</button>
    <button class="mobile-tab" data-tab="preview">Preview</button>
  `;
  main.insertBefore(tabBar, main.firstChild);

  const tabs = tabBar.querySelectorAll('.mobile-tab');
  previewPanel.classList.add('mobile-hidden');

  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.mobile-tab');
    if (!tab) return;
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (tab.dataset.tab === 'controls') {
      inputPanel.classList.remove('mobile-hidden');
      previewPanel.classList.add('mobile-hidden');
    } else {
      inputPanel.classList.add('mobile-hidden');
      previewPanel.classList.remove('mobile-hidden');
    }
  });
}
setupMobileTabs();
window.addEventListener('resize', () => {
  const existing = document.querySelector('.mobile-tabs');
  if (window.innerWidth <= 768 && !existing) setupMobileTabs();
  if (window.innerWidth > 768 && existing) {
    existing.remove();
    document.getElementById('input-panel').classList.remove('mobile-hidden');
    document.getElementById('preview-panel').classList.remove('mobile-hidden');
  }
});
