import './styles/customer.css';
import * as THREE from 'three';
import { createCustomerPanel } from './ui/CustomerPanel.js';
import { createScene, fitCameraToObject } from './engine/SceneManager.js';
import { buildAmbigram } from './engine/AmbigramBuilder.js';

// Fixed settings — customer doesn't control these
const FIXED = {
  fontFile: 'OverpassMono-Bold.ttf',
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

// Placeholder — "type two names" message
const placeholderEl = document.createElement('div');
placeholderEl.className = 'customer-placeholder';
placeholderEl.innerHTML = `
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;margin-bottom:12px">
    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>
  <span>Type two names and tap <strong>Generate</strong><br>to create your custom 3D piece</span>
`;
previewArea.appendChild(placeholderEl);

// Drag hint — arrows icon, disappears on first interaction
const dragHint = document.createElement('div');
dragHint.className = 'customer-drag-hint';
dragHint.innerHTML = `
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
  <span>Drag to rotate</span>
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
`;
previewArea.appendChild(dragHint);

// Hide drag hint on first pointer interaction with canvas
let hintDismissed = false;
function dismissHint() {
  if (hintDismissed) return;
  hintDismissed = true;
  dragHint.classList.add('hidden');
}
previewArea.addEventListener('pointerdown', dismissHint);
previewArea.addEventListener('touchstart', dismissHint, { passive: true });

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

    // Camera at base level, looking straight at Name 1
    const bbox = new THREE.Box3().setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const baseDim = Math.max(size.x, size.z, size.y * 0.5);
    const fov = ctx.camera.fov * (Math.PI / 180);
    const dist = (baseDim / 2) / Math.tan(fov / 2) * 1.5;
    const baseY = bbox.min.y;
    const ang = Math.PI / 4; // 45° angle toward Name 1
    ctx.camera.position.set(
      center.x - dist * Math.cos(ang),
      baseY,
      center.z + dist * Math.sin(ang)
    );
    ctx.camera.lookAt(center.x, center.y, center.z);
    ctx.controls.target.copy(center);
    ctx.controls.update();

    // Show drag hint after first generation
    if (!hintDismissed) {
      dragHint.classList.add('visible');
    }

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

// Change model color — receives hex color from parent (Shopify snippet)
function changeModelColor(hex) {
  if (!currentModel) return;
  const color = new THREE.Color(hex);
  currentModel.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.color.copy(color);
    }
  });
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

// Listen for messages from parent (Shopify snippet)
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'dual-name-parent') return;

  if (data.type === 'change-color' && data.hex) {
    changeModelColor(data.hex);
  }
});
