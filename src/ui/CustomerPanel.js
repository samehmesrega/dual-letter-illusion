/**
 * Minimal customer-facing UI: two name inputs, heart copy, length warning, generate button.
 *
 * @param {HTMLElement} container
 * @param {Object} callbacks
 * @param {Function} callbacks.onGenerate - Called when user clicks Generate
 * @returns {{ getNames(), setLoading(boolean) }}
 */
export function createCustomerPanel(container, callbacks) {
  container.innerHTML = `
    <div class="customer-inputs">
      <div class="customer-input-group">
        <label for="name1">Name 1</label>
        <input type="text" id="name1" maxlength="15" placeholder="e.g. LOVE" autocomplete="off" spellcheck="false" />
      </div>
      <button class="customer-heart-btn" title="Copy heart symbol ♥">&#x2665;</button>
      <div class="customer-input-group">
        <label for="name2">Name 2</label>
        <input type="text" id="name2" maxlength="15" placeholder="e.g. HATE" autocomplete="off" spellcheck="false" />
      </div>
    </div>
    <div class="customer-warning" id="length-warning">Add hearts ♥ to balance the letters in both names</div>
    <button class="customer-generate-btn" id="btn-generate">Generate Preview</button>
  `;

  const name1Input = container.querySelector('#name1');
  const name2Input = container.querySelector('#name2');
  const heartBtn = container.querySelector('.customer-heart-btn');
  const btnGenerate = container.querySelector('#btn-generate');
  const lengthWarning = container.querySelector('#length-warning');

  function checkWarning() {
    const a = name1Input.value.trim();
    const b = name2Input.value.trim();
    if (a && b && a.length !== b.length) {
      lengthWarning.classList.add('active');
    } else {
      lengthWarning.classList.remove('active');
    }
  }

  name1Input.addEventListener('input', checkWarning);
  name2Input.addEventListener('input', checkWarning);

  function onEnterKey(e) {
    if (e.key === 'Enter') callbacks.onGenerate();
  }
  name1Input.addEventListener('keydown', onEnterKey);
  name2Input.addEventListener('keydown', onEnterKey);

  btnGenerate.addEventListener('click', () => callbacks.onGenerate());

  heartBtn.addEventListener('click', () => {
    navigator.clipboard.writeText('\u2665').then(() => {
      heartBtn.style.transform = 'scale(1.3)';
      setTimeout(() => { heartBtn.style.transform = ''; }, 300);
    });
  });

  return {
    getNames() {
      return {
        name1: name1Input.value.trim(),
        name2: name2Input.value.trim()
      };
    },
    setLoading(on) {
      btnGenerate.disabled = on;
      btnGenerate.textContent = on ? 'Generating...' : 'Generate Preview';
    }
  };
}
