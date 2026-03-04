import { CURATED_FONTS } from '../fonts/curated-fonts.js';

/**
 * Create the input panel UI with text inputs, font picker, size slider, and buttons.
 *
 * @param {HTMLElement} container
 * @param {Object} callbacks
 * @param {Function} callbacks.onChange - Called with partial state on any input change
 * @param {Function} callbacks.onGenerate - Called when user clicks Generate
 * @param {Function} callbacks.onDownload - Called when user clicks Download STL
 * @returns {{ getState(), setLoading(boolean), enableDownload(boolean) }}
 */
export function createInputPanel(container, callbacks) {
  container.innerHTML = `
    <div class="panel-section">
      <label for="text-a">Name 1</label>
      <input type="text" id="text-a" maxlength="15" placeholder="e.g. LOVE" autocomplete="off" spellcheck="false" />
    </div>
    <div class="panel-section">
      <label for="text-b">Name 2</label>
      <input type="text" id="text-b" maxlength="15" placeholder="e.g. HATE" autocomplete="off" spellcheck="false" />
    </div>
    <div id="length-warning" class="warning hidden">Both names should have the same length</div>
    <div class="panel-section">
      <label for="font-select">Font</label>
      <select id="font-select"></select>
    </div>
    <div class="panel-section">
      <label for="font-size">Size: <span id="size-value">72</span></label>
      <input type="range" id="font-size" min="36" max="144" value="72" step="1" />
    </div>
    <div class="panel-section">
      <label for="corner-radius">Fillet: <span id="radius-value">5</span> mm</label>
      <input type="range" id="corner-radius" min="5" max="50" value="5" step="1" />
    </div>
    <div class="panel-section">
      <label for="base-thickness">Base Thickness: <span id="thickness-value">2</span> mm</label>
      <input type="range" id="base-thickness" min="1" max="5" value="2" step="0.5" />
    </div>
    <div class="panel-section">
      <label for="heart-style">Heart Shape</label>
      <select id="heart-style">
        <option value="1">Heart 1</option>
        <option value="2">Heart 2</option>
        <option value="3">Heart 3</option>
        <option value="4">Heart 4</option>
        <option value="5">Heart 5</option>
        <option value="6">Heart 6</option>
        <option value="7">Heart 7</option>
        <option value="8">Heart 8</option>
        <option value="9">Heart 9</option>
        <option value="10">Heart 10</option>
        <option value="11">Heart 11</option>
        <option value="12">Heart 12</option>
        <option value="13">Heart 13</option>
        <option value="14">Heart 14</option>
        <option value="15">Heart 15</option>
        <option value="16">Heart 16</option>
        <option value="17">Heart 17</option>
        <option value="18">Heart 18</option>
        <option value="19">Heart 19</option>
        <option value="20">Heart 20</option>
      </select>
    </div>
    <div class="panel-section">
      <label for="inscription-text">Text on base</label>
      <input type="text" id="inscription-text" maxlength="60" placeholder="e.g. Made with love / بحبك" autocomplete="off" spellcheck="false" />
    </div>
    <div class="panel-actions">
      <button id="btn-generate" class="btn-primary">Generate</button>
      <button id="btn-download" class="btn-secondary" disabled>Download STL</button>
    </div>
    <div class="panel-actions">
      <button id="btn-wireframe" class="btn-secondary">Wireframe: OFF</button>
    </div>

    <div class="batch-separator"></div>

    <div class="panel-section">
      <label for="sheet-url">Google Sheet URL</label>
      <input type="url" id="sheet-url" placeholder="Paste Google Sheets link" autocomplete="off" />
    </div>
    <div class="panel-actions">
      <button id="btn-batch" class="btn-primary">Generate from Sheet</button>
    </div>
    <div id="batch-progress" class="batch-progress hidden">
      <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
      <span id="batch-status" class="batch-status"></span>
    </div>
  `;

  // Populate font dropdown
  const fontSelect = container.querySelector('#font-select');
  for (const font of CURATED_FONTS) {
    const opt = document.createElement('option');
    opt.value = font.file;
    opt.textContent = font.name;
    fontSelect.appendChild(opt);
  }

  // Elements
  const textAInput    = container.querySelector('#text-a');
  const textBInput    = container.querySelector('#text-b');
  const sizeInput     = container.querySelector('#font-size');
  const sizeValue     = container.querySelector('#size-value');
  const radiusInput     = container.querySelector('#corner-radius');
  const radiusValue     = container.querySelector('#radius-value');
  const thicknessInput  = container.querySelector('#base-thickness');
  const thicknessValue  = container.querySelector('#thickness-value');
  const inscriptionInput = container.querySelector('#inscription-text');
  const heartStyleSelect = container.querySelector('#heart-style');
  const btnGenerate     = container.querySelector('#btn-generate');
  const btnDownload   = container.querySelector('#btn-download');
  const lengthWarning = container.querySelector('#length-warning');

  // Event handlers
  function emitChange() {
    const textA = textAInput.value.trim();
    const textB = textBInput.value.trim();

    // Show warning if lengths differ
    if (textA && textB && textA.length !== textB.length) {
      lengthWarning.classList.remove('hidden');
    } else {
      lengthWarning.classList.add('hidden');
    }

    callbacks.onChange({
      textA,
      textB,
      fontFile:       fontSelect.value,
      fontSize:       parseInt(sizeInput.value),
      cornerRadius:   parseFloat(radiusInput.value),
      baseThickness:  parseFloat(thicknessInput.value),
      heartStyle:     parseInt(heartStyleSelect.value),
      inscriptionText: inscriptionInput.value.trim()
    });
  }

  textAInput.addEventListener('input', emitChange);
  textBInput.addEventListener('input', emitChange);
  inscriptionInput.addEventListener('input', emitChange);
  fontSelect.addEventListener('change', emitChange);
  heartStyleSelect.addEventListener('change', emitChange);
  sizeInput.addEventListener('input', () => {
    sizeValue.textContent = sizeInput.value;
    emitChange();
  });
  radiusInput.addEventListener('input', () => {
    radiusValue.textContent = radiusInput.value;
    emitChange();
  });
  thicknessInput.addEventListener('input', () => {
    thicknessValue.textContent = thicknessInput.value;
    emitChange();
  });

  const btnWireframe = container.querySelector('#btn-wireframe');
  const sheetUrlInput = container.querySelector('#sheet-url');
  const btnBatch = container.querySelector('#btn-batch');
  const batchProgress = container.querySelector('#batch-progress');
  const progressFill = container.querySelector('#progress-fill');
  const batchStatus = container.querySelector('#batch-status');
  let wireframeOn = false;

  btnGenerate.addEventListener('click', () => callbacks.onGenerate());
  btnDownload.addEventListener('click', () => callbacks.onDownload());
  btnWireframe.addEventListener('click', () => {
    wireframeOn = !wireframeOn;
    btnWireframe.textContent = wireframeOn ? 'Wireframe: ON' : 'Wireframe: OFF';
    if (callbacks.onWireframeToggle) callbacks.onWireframeToggle(wireframeOn);
  });
  btnBatch.addEventListener('click', () => {
    if (callbacks.onBatchGenerate) callbacks.onBatchGenerate(sheetUrlInput.value.trim());
  });

  return {
    getState() {
      return {
        textA:        textAInput.value.trim(),
        textB:        textBInput.value.trim(),
        fontFile:     fontSelect.value,
        fontSize:     parseInt(sizeInput.value),
        cornerRadius:  parseFloat(radiusInput.value),
        baseThickness: parseFloat(thicknessInput.value),
        heartStyle:    parseInt(heartStyleSelect.value),
        inscriptionText: inscriptionInput.value.trim()
      };
    },
    setLoading(on) {
      btnGenerate.disabled = on;
      btnGenerate.textContent = on ? 'Generating...' : 'Generate';
    },
    enableDownload(enabled) {
      btnDownload.disabled = !enabled;
    },
    setBatchProgress(current, total, status) {
      batchProgress.classList.remove('hidden');
      progressFill.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
      batchStatus.textContent = status;
    },
    setBatchLoading(on) {
      btnBatch.disabled = on;
      btnBatch.textContent = on ? 'Processing...' : 'Generate from Sheet';
      if (!on) batchProgress.classList.add('hidden');
    }
  };
}
