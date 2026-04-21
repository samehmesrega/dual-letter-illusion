// Color Rules editor modal — manage per-color slicer overrides for batch mode.
//
// Schema (matches server.js validateRule):
//   { id, color, enabled, settings: { baseThickness?, fill_pattern?, ...slicerKeys } }
//
// Slicer setting groups (defaults shown as placeholders match optimized.ini):
const SETTING_GROUPS = [
  {
    title: 'Temperature',
    open: true,
    fields: [
      { key: 'temperature',                  label: 'Hotend',           placeholder: '215' },
      { key: 'first_layer_temperature',      label: 'Hotend (1st)',     placeholder: '220' },
      { key: 'bed_temperature',              label: 'Bed',              placeholder: '60' },
      { key: 'first_layer_bed_temperature',  label: 'Bed (1st)',        placeholder: '60' }
    ]
  },
  {
    title: 'Cooling',
    open: false,
    fields: [
      { key: 'min_fan_speed', label: 'Fan Min %', placeholder: '100' },
      { key: 'max_fan_speed', label: 'Fan Max %', placeholder: '100' }
    ]
  },
  {
    title: 'Speeds',
    open: false,
    fields: [
      { key: 'perimeter_speed',          label: 'Perimeter',          placeholder: '200' },
      { key: 'external_perimeter_speed', label: 'External Perimeter', placeholder: '150' },
      { key: 'infill_speed',             label: 'Infill',             placeholder: '200' },
      { key: 'solid_infill_speed',       label: 'Solid Infill',       placeholder: '200' },
      { key: 'top_solid_infill_speed',   label: 'Top Solid Infill',   placeholder: '150' },
      { key: 'first_layer_speed',        label: 'First Layer',        placeholder: '60' },
      { key: 'travel_speed',             label: 'Travel',             placeholder: '300' },
      { key: 'max_print_speed',          label: 'Max Print',          placeholder: '200' },
      { key: 'support_material_speed',   label: 'Support',            placeholder: '150' }
    ]
  },
  {
    title: 'Geometry',
    open: false,
    fields: [
      { key: 'baseThickness',      label: 'Base Thickness (mm)', placeholder: '2',   step: '0.5' },
      { key: 'layer_height',       label: 'Layer Height (mm)',   placeholder: '0.3', step: '0.05' },
      { key: 'first_layer_height', label: 'First Layer (mm)',    placeholder: '0.3', step: '0.05' }
    ]
  }
];

const FILL_PATTERNS = ['gyroid', 'rectilinear', 'grid'];

function summarizeSettings(settings) {
  const count = Object.keys(settings || {}).length;
  return count === 0 ? '(none)' : `${count} ${count === 1 ? 'key' : 'keys'}`;
}

function close(overlay) {
  overlay.remove();
}

// Render the rules list table
function renderTable(rules, onEdit, onDelete, onToggle) {
  if (rules.length === 0) {
    return `<p style="color:var(--color-text-muted); font-size:0.9rem; text-align:center; padding:20px 0;">No rules yet. Click "Add Rule" to create one.</p>`;
  }
  return `
    <table class="report-table">
      <thead><tr>
        <th style="width:48px;">On</th>
        <th>Color</th>
        <th>Settings</th>
        <th style="width:120px;">Actions</th>
      </tr></thead>
      <tbody>
        ${rules.map((r, i) => `
          <tr>
            <td><input type="checkbox" data-toggle="${i}" ${r.enabled ? 'checked' : ''} /></td>
            <td><strong>${escapeHtml(r.color)}</strong></td>
            <td style="color:var(--color-text-muted); font-size:0.85rem;">${summarizeSettings(r.settings)}</td>
            <td>
              <button class="btn-secondary" data-edit="${i}" style="padding:4px 10px; font-size:0.8rem; margin-right:4px;">Edit</button>
              <button class="btn-secondary" data-delete="${i}" style="padding:4px 10px; font-size:0.8rem;">✕</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Render the per-rule editor (used for both "Add" and "Edit")
function renderEditor(rule) {
  const groupsHtml = SETTING_GROUPS.map(group => `
    <details class="panel-details" ${group.open ? 'open' : ''}>
      <summary>${group.title}</summary>
      <div class="panel-details-content">
        ${group.fields.map(f => `
          <div class="panel-section">
            <label for="rule-${f.key}" style="font-size:0.85rem;">${f.label}</label>
            <input type="number" id="rule-${f.key}" data-setting-key="${f.key}"
                   placeholder="${f.placeholder}" ${f.step ? `step="${f.step}"` : ''}
                   value="${rule.settings?.[f.key] ?? ''}" />
          </div>
        `).join('')}
      </div>
    </details>
  `).join('');

  const patternOptions = FILL_PATTERNS.map(p => `
    <option value="${p}" ${rule.settings?.fill_pattern === p ? 'selected' : ''}>${p}</option>
  `).join('');

  return `
    <div style="display:flex; gap:12px; margin-bottom:12px;">
      <div class="panel-section" style="flex:1;">
        <label for="rule-color">Color name</label>
        <input type="text" id="rule-color" value="${escapeHtml(rule.color || '')}" placeholder="e.g. white" />
      </div>
      <div class="panel-section" style="display:flex; align-items:flex-end;">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; padding-bottom:8px;">
          <input type="checkbox" id="rule-enabled" ${rule.enabled !== false ? 'checked' : ''} /> Enabled
        </label>
      </div>
    </div>

    ${groupsHtml}

    <details class="panel-details">
      <summary>Pattern</summary>
      <div class="panel-details-content">
        <div class="panel-section">
          <label for="rule-fill_pattern">Infill Pattern</label>
          <select id="rule-fill_pattern" data-setting-key="fill_pattern">
            <option value="">(use profile default)</option>
            ${patternOptions}
          </select>
        </div>
      </div>
    </details>

    <p style="font-size:0.8rem; color:var(--color-text-muted); margin:12px 0;">
      Empty fields fall back to the profile's defaults. Out-of-range values are silently dropped on save.
    </p>
  `;
}

// Read editor inputs into a rule object
function collectRule(container, existingId) {
  const color = container.querySelector('#rule-color').value.trim();
  const enabled = container.querySelector('#rule-enabled').checked;
  const settings = {};
  container.querySelectorAll('input[data-setting-key]').forEach(input => {
    const key = input.dataset.settingKey;
    if (input.value === '') return;
    settings[key] = input.type === 'number' ? Number(input.value) : input.value;
  });
  const patternSel = container.querySelector('select[data-setting-key="fill_pattern"]');
  if (patternSel && patternSel.value) settings.fill_pattern = patternSel.value;
  return { id: existingId, color, enabled, settings };
}

export async function openColorRulesModal() {
  // Avoid double-open
  document.querySelector('.color-rules-overlay')?.remove();

  // Fetch initial rules
  let rules = [];
  try {
    const res = await fetch('/api/color-rules');
    if (res.ok) rules = (await res.json()).rules || [];
  } catch (e) {
    console.warn('Color rules fetch failed:', e);
  }

  // Modal scaffold (reuse batch-report-* styles + add a marker class for unique selector)
  const overlay = document.createElement('div');
  overlay.className = 'batch-report-overlay color-rules-overlay';
  overlay.innerHTML = `
    <div class="batch-report-modal" style="max-width:720px;">
      <h3>Color Rules</h3>
      <div id="cr-body"></div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn-primary" id="cr-save">Save All</button>
        <button class="btn-secondary" id="cr-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('#cr-body');
  let mode = 'list';  // 'list' | 'editor'
  let editingIndex = -1;

  function renderList() {
    mode = 'list';
    editingIndex = -1;
    body.innerHTML = `
      <div style="margin-bottom:12px;">
        <button class="btn-primary" id="cr-add" style="padding:6px 14px; font-size:0.85rem;">+ Add Rule</button>
      </div>
      ${renderTable(rules)}
    `;
    body.querySelector('#cr-add').addEventListener('click', () => openEditor({ color: '', enabled: true, settings: {} }, -1));
    body.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.edit);
        openEditor(rules[i], i);
      });
    });
    body.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.delete);
        if (confirm(`Delete rule for "${rules[i].color}"?`)) {
          rules.splice(i, 1);
          renderList();
        }
      });
    });
    body.querySelectorAll('[data-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        const i = Number(cb.dataset.toggle);
        rules[i].enabled = cb.checked;
      });
    });
  }

  function openEditor(rule, index) {
    mode = 'editor';
    editingIndex = index;
    body.innerHTML = `
      ${renderEditor(rule)}
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn-primary" id="cr-save-rule">${index === -1 ? 'Add' : 'Update'}</button>
        <button class="btn-secondary" id="cr-cancel-edit">Cancel</button>
      </div>
    `;
    body.querySelector('#cr-save-rule').addEventListener('click', () => {
      const collected = collectRule(body, rule.id);
      if (!collected.color) {
        alert('Color name is required.');
        return;
      }
      if (index === -1) rules.push(collected);
      else rules[index] = { ...rules[index], ...collected };
      renderList();
    });
    body.querySelector('#cr-cancel-edit').addEventListener('click', renderList);
  }

  renderList();

  overlay.querySelector('#cr-close').addEventListener('click', () => close(overlay));
  overlay.querySelector('#cr-save').addEventListener('click', async () => {
    if (mode === 'editor') {
      alert('Apply or cancel the open rule editor first.');
      return;
    }
    const btn = overlay.querySelector('#cr-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const res = await fetch('/api/color-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules })
      });
      if (!res.ok) throw new Error('Save failed');
      const json = await res.json();
      rules = json.rules || [];
      btn.textContent = 'Saved!';
      setTimeout(() => close(overlay), 600);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Save All';
      alert('Save failed: ' + e.message);
    }
  });

  // Click outside modal to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(overlay);
  });
}
