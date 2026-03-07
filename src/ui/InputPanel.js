import { FONT_FILE } from '../fonts/curated-fonts.js';

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
      <span id="copy-heart" class="copy-heart" title="Copy heart symbol">&#x2665;</span>
    </div>
    <div class="panel-section">
      <label for="text-b">Name 2</label>
      <input type="text" id="text-b" maxlength="15" placeholder="e.g. HATE" autocomplete="off" spellcheck="false" />
    </div>
    <div id="length-warning" class="warning hidden">ADD HEARTS TO BALANCE THE LETTERS IN BOTH NAMES</div>
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
      <label for="order-number">Order Number</label>
      <input type="text" id="order-number" maxlength="30" placeholder="e.g. 1001" autocomplete="off" spellcheck="false" />
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

  // Elements
  const textAInput    = container.querySelector('#text-a');
  const textBInput    = container.querySelector('#text-b');
  const sizeInput     = container.querySelector('#font-size');
  const sizeValue     = container.querySelector('#size-value');
  const radiusInput     = container.querySelector('#corner-radius');
  const radiusValue     = container.querySelector('#radius-value');
  const thicknessInput  = container.querySelector('#base-thickness');
  const thicknessValue  = container.querySelector('#thickness-value');
  const orderNumberInput = container.querySelector('#order-number');
  const inscriptionInput = container.querySelector('#inscription-text');
  const copyHeartBtn    = container.querySelector('#copy-heart');
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
      fontFile:       FONT_FILE,
      fontSize:       parseInt(sizeInput.value),
      cornerRadius:   parseFloat(radiusInput.value),
      baseThickness:  parseFloat(thicknessInput.value),
      heartStyle:     9,
      inscriptionText: inscriptionInput.value.trim(),
      orderNumber: orderNumberInput.value.trim()
    });
  }

  textAInput.addEventListener('input', emitChange);
  textBInput.addEventListener('input', emitChange);
  orderNumberInput.addEventListener('input', emitChange);
  inscriptionInput.addEventListener('input', emitChange);

  // Enter key triggers Generate
  function onEnterKey(e) {
    if (e.key === 'Enter') callbacks.onGenerate();
  }
  textAInput.addEventListener('keydown', onEnterKey);
  textBInput.addEventListener('keydown', onEnterKey);
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
  copyHeartBtn.addEventListener('click', () => {
    navigator.clipboard.writeText('\u2665').then(() => {
      copyHeartBtn.classList.add('copied');
      setTimeout(() => copyHeartBtn.classList.remove('copied'), 800);
    });
  });

  return {
    getState() {
      return {
        textA:        textAInput.value.trim(),
        textB:        textBInput.value.trim(),
        fontFile:     FONT_FILE,
        fontSize:     parseInt(sizeInput.value),
        cornerRadius:  parseFloat(radiusInput.value),
        baseThickness: parseFloat(thicknessInput.value),
        heartStyle:    9,
        inscriptionText: inscriptionInput.value.trim(),
        orderNumber: orderNumberInput.value.trim()
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
