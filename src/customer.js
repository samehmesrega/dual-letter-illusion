import './styles/customer.css';
import { createCustomerPanel } from './ui/CustomerPanel.js';
import { createScene, fitCameraToObject } from './engine/SceneManager.js';
import { buildAmbigram } from './engine/AmbigramBuilder.js';

// Fixed settings — customer doesn't control these
const FIXED = {
  fontFile: 'Anton-Regular.ttf',
  fontSize: 72,
  cornerRadius: 5,
  baseThickness: 2,
  heartStyle: 9,
  inscriptionText: ''
};

// Scene setup
const previewArea = document.getElementById('preview-area');
const ctx = createScene(previewArea);
ctx.animate();

// Loading overlay
const loadingEl = document.createElement('div');
loadingEl.className = 'customer-loading';
loadingEl.innerHTML = '<div class="spinner"></div><span>Generating your preview...</span>';
previewArea.appendChild(loadingEl);

// Placeholder
const placeholderEl = document.createElement('div');
placeholderEl.className = 'customer-placeholder';
placeholderEl.textContent = 'Enter two names and tap Generate to see your 3D preview';
previewArea.appendChild(placeholderEl);

// Error toast
const errorEl = document.createElement('div');
errorEl.className = 'customer-error';
previewArea.appendChild(errorEl);

// Customer panel
const panel = createCustomerPanel(document.getElementById('customer-controls'), {
  onGenerate: handleGenerate
});

// State
let currentModel = null;

async function handleGenerate() {
  const { name1, name2 } = panel.getNames();

  if (!name1 || !name2) {
    showError('Please enter both names.');
    return;
  }

  panel.setLoading(true);
  loadingEl.classList.add('active');
  placeholderEl.style.display = 'none';
  notifyParent('preview-loading');

  try {
    const model = await buildAmbigram({
      textA: name1,
      textB: name2,
      fontUrl: `/fonts/${FIXED.fontFile}`,
      fontSize: FIXED.fontSize,
      cornerRadius: FIXED.cornerRadius,
      baseHeight: FIXED.baseThickness,
      heartStyle: FIXED.heartStyle,
      inscriptionText: FIXED.inscriptionText
    });

    // Remove old model
    if (currentModel) {
      ctx.scene.remove(currentModel);
      disposeGroup(currentModel);
    }

    currentModel = model;
    ctx.scene.add(model);
    fitCameraToObject(ctx.camera, model, ctx.controls);

    // Capture screenshot synchronously after render
    ctx.renderer.render(ctx.scene, ctx.camera);
    const screenshot = ctx.renderer.domElement.toDataURL('image/jpeg', 0.8);

    notifyParent('preview-ready', { name1, name2, screenshot });
  } catch (err) {
    console.error('Generation failed:', err);
    showError('Failed to generate. Try different names.');
    notifyParent('preview-error', { message: err.message });
  }

  panel.setLoading(false);
  loadingEl.classList.remove('active');
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add('active');
  setTimeout(() => errorEl.classList.remove('active'), 4000);
}

function notifyParent(type, data = {}) {
  if (window.parent !== window) {
    window.parent.postMessage({ source: 'dual-name', type, ...data }, '*');
  }
}

function disposeGroup(group) {
  group.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

// Listen for optional init message from parent
window.addEventListener('message', (event) => {
  if (event.data?.type === 'init') {
    // Future: could accept config overrides
  }
});
