import { createScene, fitCameraToObject } from '../engine/SceneManager.js';

/**
 * Create the 3D preview panel wrapping SceneManager.
 *
 * @param {HTMLElement} container
 * @returns {{ setModel(group), showLoading(on), showError(msg), clearError(), getRenderer() }}
 */
export function createPreviewPanel(container) {
  // Add loading overlay
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.className = 'hidden';
  overlay.innerHTML = `
    <div class="spinner"></div>
    <p>Generating model...</p>
  `;
  container.appendChild(overlay);

  // Add error message
  const errorEl = document.createElement('div');
  errorEl.id = 'error-message';
  errorEl.className = 'hidden';
  container.appendChild(errorEl);

  // Add placeholder text
  const placeholder = document.createElement('div');
  placeholder.id = 'preview-placeholder';
  placeholder.innerHTML = `
    <p>Enter two words and click <strong>Generate</strong></p>
    <p class="sub">The 3D preview will appear here</p>
  `;
  container.appendChild(placeholder);

  // Add reset camera button
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-reset-camera';
  resetBtn.title = 'Reset camera';
  resetBtn.innerHTML = '&#x21ba;';
  container.appendChild(resetBtn);

  const ctx = createScene(container);
  ctx.animate();

  let currentModel = null;

  resetBtn.addEventListener('click', () => {
    if (currentModel) {
      fitCameraToObject(ctx.camera, currentModel, ctx.controls);
    }
  });

  return {
    setModel(group) {
      // Remove old model
      if (currentModel) {
        ctx.scene.remove(currentModel);
        disposeGroup(currentModel);
      }

      // Hide placeholder
      placeholder.classList.add('hidden');

      currentModel = group;
      ctx.scene.add(group);
      fitCameraToObject(ctx.camera, group, ctx.controls);
    },

    showLoading(on) {
      if (on) {
        overlay.classList.remove('hidden');
      } else {
        overlay.classList.add('hidden');
      }
    },

    showError(msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
      setTimeout(() => errorEl.classList.add('hidden'), 5000);
    },

    clearError() {
      errorEl.classList.add('hidden');
    },

    getRenderer() {
      return ctx.renderer;
    }
  };
}

/**
 * Recursively dispose all geometries and materials in a group.
 */
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
