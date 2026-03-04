import './styles/main.css';
import * as THREE from 'three';
import { createInputPanel } from './ui/InputPanel.js';
import { createPreviewPanel } from './ui/PreviewPanel.js';
import { buildAmbigram, debugLog } from './engine/AmbigramBuilder.js';
import { exportToSTL } from './engine/STLExporter.js';
import { DEFAULT_FONT, INSCRIPTION_FONT } from './fonts/curated-fonts.js';

// App state
const state = {
  textA: '',
  textB: '',
  fontFile:      DEFAULT_FONT.file,
  fontSize:      72,
  cornerRadius:  5,
  baseThickness: 2,
  inscriptionText: '',
  currentModel:  null
};

// Initialize UI
const inputPanel = createInputPanel(document.getElementById('input-panel'), {
  onChange: handleInputChange,
  onGenerate: handleGenerate,
  onDownload: handleDownload,
  onWireframeToggle: handleWireframeToggle
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
      inscriptionText: state.inscriptionText,
      inscriptionFontUrl: `/fonts/${INSCRIPTION_FONT}`
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
  const filename = `DualLetter_${state.textA}_${state.textB}.stl`;
  exportToSTL(state.currentModel, filename);
}

function handleWireframeToggle(on) {
  if (!state.currentModel) return;
  state.currentModel.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.wireframe = on;
    }
  });
}

// --- Copy Debug button ---
const debugBtn = document.createElement('button');
debugBtn.textContent = 'Copy Debug';
debugBtn.className = 'btn-secondary';
debugBtn.style.marginTop = '8px';
debugBtn.addEventListener('click', () => {
  let output = debugLog.join('\n');

  // Add current model stats
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
    debugBtn.textContent = 'Copied!';
    setTimeout(() => { debugBtn.textContent = 'Copy Debug'; }, 1500);
  });
});

// Append to input panel
const panel = document.getElementById('input-panel');
const actionsDiv = document.createElement('div');
actionsDiv.className = 'panel-actions';
actionsDiv.appendChild(debugBtn);
panel.appendChild(actionsDiv);
