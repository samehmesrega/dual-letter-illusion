import express from 'express';
import multer from 'multer';
import { execFile } from 'child_process';
import { readFile, writeFile, mkdir, rename, unlink, readdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { google } from 'googleapis';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: tmpdir() });
const PORT = process.env.PORT || 3001;

// Slicer profiles directory
const PROFILES_DIR = join(__dirname, 'slicer-profiles', 'prusa-slicer');

// Slicer override allowlist with per-key ranges. Used by color rules
// (batch-mode per-color overrides applied on top of the selected profile).
const ALLOWED_OVERRIDE_KEYS = {
  perimeter_speed:             { min: 10,   max: 500 },
  external_perimeter_speed:    { min: 10,   max: 500 },
  infill_speed:                { min: 10,   max: 500 },
  solid_infill_speed:          { min: 10,   max: 500 },
  top_solid_infill_speed:      { min: 10,   max: 500 },
  first_layer_speed:           { min: 10,   max: 500 },
  travel_speed:                { min: 10,   max: 500 },
  max_print_speed:             { min: 10,   max: 500 },
  support_material_speed:      { min: 10,   max: 500 },
  temperature:                 { min: 150,  max: 280 },
  first_layer_temperature:     { min: 150,  max: 280 },
  bed_temperature:             { min: 0,    max: 120 },
  first_layer_bed_temperature: { min: 0,    max: 120 },
  min_fan_speed:               { min: 0,    max: 100 },
  max_fan_speed:               { min: 0,    max: 100 },
  layer_height:                { min: 0.05, max: 0.5 },
  first_layer_height:          { min: 0.05, max: 0.5 }
};
const ALLOWED_FILL_PATTERNS = new Set(['gyroid', 'rectilinear', 'grid']);

async function writeOverridesIni(overrides) {
  const lines = [];
  for (const [key, value] of Object.entries(overrides || {})) {
    if (ALLOWED_OVERRIDE_KEYS[key]) {
      const n = Number(value);
      const { min, max } = ALLOWED_OVERRIDE_KEYS[key];
      if (Number.isFinite(n) && n >= min && n <= max) lines.push(`${key} = ${n}`);
    } else if (key === 'fill_pattern' && ALLOWED_FILL_PATTERNS.has(value)) {
      lines.push(`fill_pattern = ${value}`);
    }
    // silently ignore anything else — security: prevent ini injection
  }
  if (lines.length === 0) return null;
  const path = join(tmpdir(), `slicer-overrides-${Date.now()}-${Math.random().toString(36).slice(2)}.ini`);
  await writeFile(path, lines.join('\n') + '\n');
  return path;
}

// ── Color rules: per-color slicer settings applied automatically in batch mode ──
const COLOR_RULES_PATH = join(__dirname, 'data', 'color-rules.json');

async function readColorRules() {
  try { return JSON.parse(await readFile(COLOR_RULES_PATH, 'utf8')); }
  catch { return { rules: [] }; }
}

async function writeColorRules(data) {
  await mkdir(dirname(COLOR_RULES_PATH), { recursive: true });
  await writeFile(COLOR_RULES_PATH, JSON.stringify(data, null, 2));
}

function validateRule(rule) {
  if (!rule || typeof rule.color !== 'string' || !rule.color.trim()) return null;
  const cleaned = {
    id: typeof rule.id === 'string' && rule.id
      ? rule.id
      : `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    color: rule.color.trim(),
    enabled: rule.enabled !== false,
    settings: {}
  };
  for (const [key, value] of Object.entries(rule.settings || {})) {
    if (key === 'fill_pattern' && ALLOWED_FILL_PATTERNS.has(value)) {
      cleaned.settings[key] = value;
    } else if (key === 'baseThickness') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 1 && n <= 5) cleaned.settings[key] = n;
    } else if (ALLOWED_OVERRIDE_KEYS[key]) {
      const n = Number(value);
      const { min, max } = ALLOWED_OVERRIDE_KEYS[key];
      if (Number.isFinite(n) && n >= min && n <= max) cleaned.settings[key] = n;
    }
    // anything else silently dropped (security)
  }
  return cleaned;
}

// ── Google Drive upload (OAuth2 preferred, uploads as real user with quota) ──
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
let driveClient = null;

// OAuth2 first (uploads as real user — has storage quota)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
  try {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    driveClient = google.drive({ version: 'v3', auth: oauth2 });
    console.log('Google Drive upload enabled (OAuth2)');
  } catch (e) {
    console.warn('Google Drive setup failed:', e.message);
  }
}

async function uploadToDrive(filePath, filename) {
  if (!driveClient) return { success: false, reason: 'Drive client not initialized (check GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN env vars)' };
  if (!DRIVE_FOLDER_ID) return { success: false, reason: 'GOOGLE_DRIVE_FOLDER_ID env var is not set' };
  try {
    await driveClient.files.create({
      requestBody: { name: filename, parents: [DRIVE_FOLDER_ID] },
      media: { mimeType: 'application/octet-stream', body: createReadStream(filePath) },
      supportsAllDrives: true  // allow uploading to Shared Drives
    });
    console.log(`Uploaded to Drive: ${filename}`);
    return { success: true };
  } catch (e) {
    // Surface full Google API error details (e.g. invalid_grant, File not found, Insufficient Permission)
    const detail = e.errors?.[0]?.message || e.response?.data?.error?.message || e.message;
    console.error('Drive upload failed:', detail);
    return { success: false, reason: detail };
  }
}

// ── Run PrusaSlicer to produce G-code ──
async function runSlicer(profileName, stlPath, gcodePath, overridesPath = null) {
  const profilePath = join(PROFILES_DIR, `${profileName}.ini`);
  const supportPath = join(PROFILES_DIR, 'support-override.ini');

  const args = [
    '--export-gcode',
    '--load', profilePath,
    '--load', supportPath,
    ...(overridesPath ? ['--load', overridesPath] : []),
    '--center', '112.5,112.5',
    '--output', gcodePath,
    stlPath
  ];

  return new Promise((resolve, reject) => {
    execFile('prusa-slicer', args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('PrusaSlicer stderr:', stderr);
        console.error('PrusaSlicer error:', err.message);
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ── Check if PrusaSlicer is available ──
async function checkSlicerAvailable() {
  return new Promise((resolve) => {
    execFile('prusa-slicer', ['--help'], { timeout: 10_000 }, (err) => {
      resolve(!err);
    });
  });
}

// ── Non-uniform scale binary STL to exact target dimensions (mm) ──
async function scaleSTL(filePath, targetX, targetY, targetZ) {
  const buf = Buffer.from(await readFile(filePath));
  const triCount = buf.readUInt32LE(80);
  // First pass: find bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < triCount; i++) {
    const off = 84 + i * 50;
    for (let v = 0; v < 3; v++) {
      const vOff = off + 12 + v * 12;
      const x = buf.readFloatLE(vOff);
      const y = buf.readFloatLE(vOff + 4);
      const z = buf.readFloatLE(vOff + 8);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const sx = targetX / (maxX - minX);
  const sy = targetY / (maxY - minY);
  const sz = targetZ / (maxZ - minZ);
  // Second pass: scale vertices (center at origin first)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < triCount; i++) {
    const off = 84 + i * 50;
    // Scale normal
    const nx = buf.readFloatLE(off) * sx;
    const ny = buf.readFloatLE(off + 4) * sy;
    const nz = buf.readFloatLE(off + 8) * sz;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    buf.writeFloatLE(nx / nLen, off);
    buf.writeFloatLE(ny / nLen, off + 4);
    buf.writeFloatLE(nz / nLen, off + 8);
    // Scale vertices
    for (let v = 0; v < 3; v++) {
      const vOff = off + 12 + v * 12;
      buf.writeFloatLE((buf.readFloatLE(vOff) - cx) * sx, vOff);
      buf.writeFloatLE((buf.readFloatLE(vOff + 4) - cy) * sy, vOff + 4);
      buf.writeFloatLE((buf.readFloatLE(vOff + 8) - cz) * sz, vOff + 8);
    }
  }
  await writeFile(filePath, buf);
}

// Serve built static files
app.use(express.static(join(__dirname, 'dist')));

// ── Slicer status check ──
app.get('/api/slicer-status', async (_req, res) => {
  const slicerOk = await checkSlicerAvailable();
  const driveOk = !!(driveClient && DRIVE_FOLDER_ID);
  res.json({ slicer: slicerOk, drive: driveOk });
});

// ── Drive diagnostic — tells you exactly what's wrong with the Drive setup ──
app.get('/api/drive-diagnostic', async (_req, res) => {
  const env = {
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: !!process.env.GOOGLE_REFRESH_TOKEN,
    GOOGLE_DRIVE_FOLDER_ID: !!process.env.GOOGLE_DRIVE_FOLDER_ID
  };
  const missing = Object.entries(env).filter(([_, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    return res.json({ ok: false, stage: 'env', missing, env });
  }
  if (!driveClient) {
    return res.json({ ok: false, stage: 'init', reason: 'driveClient not initialized despite env vars being set' });
  }
  // Try a minimal operation: get folder metadata
  try {
    const meta = await driveClient.files.get({
      fileId: DRIVE_FOLDER_ID,
      fields: 'id, name, mimeType, trashed, driveId',
      supportsAllDrives: true  // allow lookup in Shared Drives
    });
    if (meta.data.trashed) {
      return res.json({ ok: false, stage: 'folder', reason: 'Folder is in trash', folder: meta.data });
    }
    return res.json({ ok: true, env, folder: meta.data });
  } catch (e) {
    const detail = e.errors?.[0]?.message || e.response?.data?.error?.message || e.message;
    const code = e.code || e.response?.status;
    let hint = null;
    if (/invalid_grant/i.test(detail)) hint = 'Refresh token expired or revoked. Re-authorize and update GOOGLE_REFRESH_TOKEN.';
    else if (/File not found/i.test(detail)) hint = 'GOOGLE_DRIVE_FOLDER_ID points to a folder that does not exist or you cannot access.';
    else if (/Insufficient Permission|insufficientPermissions/i.test(detail)) hint = 'OAuth scope is too narrow. Re-authorize with drive.file or drive scope.';
    else if (code === 403 && /quota/i.test(detail)) hint = 'Drive storage quota exceeded.';
    return res.json({ ok: false, stage: 'api', code, reason: detail, hint });
  }
});

// ── Color rules ──
app.get('/api/color-rules', async (_req, res) => {
  res.json(await readColorRules());
});

app.put('/api/color-rules', express.json({ limit: '100kb' }), async (req, res) => {
  const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
  const validated = rules.map(validateRule).filter(r => r !== null);
  await writeColorRules({ rules: validated });
  res.json({ rules: validated });
});

// ── List available profiles ──
app.get('/api/profiles', async (_req, res) => {
  try {
    const files = await readdir(PROFILES_DIR);
    const profiles = files
      .filter(f => f.endsWith('.ini') && !f.startsWith('support') && !f.startsWith('printer'))
      .map(f => ({
        id: f.replace('.ini', ''),
        name: f.replace('.ini', '').replace(/_/g, ' ')
      }));
    res.json(profiles);
  } catch {
    res.json([]);
  }
});

// ── Slice STL → G-code ──
app.post('/api/slice', upload.single('stl'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No STL file uploaded' });

  const profile = req.body.profile || 'optimized';
  const rawPath = req.file.path;
  const stlPath = rawPath + '.stl';
  const gcodeFilename = req.body.filename
    ? req.body.filename.replace(/\.stl$/i, '.gcode')
    : 'output.gcode';
  const gcodePath = rawPath + '.gcode';

  try {
    await rename(rawPath, stlPath);

    const autoScale = req.body.autoScale !== '0';
    if (autoScale) {
      const targetX = 192, targetZ = 37;
      const targetY = req.body.hasInscription ? 48 : 42;
      await scaleSTL(stlPath, targetX, targetY, targetZ);
    } else {
      // Custom dimensions: apply only if all 3 are present and within range
      const clamp = n => Math.max(1, Math.min(300, n));
      const cx = parseFloat(req.body.customScaleX);
      const cy = parseFloat(req.body.customScaleY);
      const cz = parseFloat(req.body.customScaleZ);
      if ([cx, cy, cz].every(n => Number.isFinite(n) && n > 0)) {
        await scaleSTL(stlPath, clamp(cx), clamp(cy), clamp(cz));
      }
      // else: skip scaling entirely (use STL as-is)
    }

    await runSlicer(profile, stlPath, gcodePath);

    // Upload to Google Drive (must finish before cleanup deletes the file)
    await uploadToDrive(gcodePath, gcodeFilename);

    const gcode = await readFile(gcodePath);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${gcodeFilename}"`
    });
    res.send(gcode);
  } catch (err) {
    console.error('Slice failed:', err.message);
    const slicerOk = await checkSlicerAvailable();
    const hint = !slicerOk ? ' (PrusaSlicer not found on server)' : '';
    res.status(500).json({ error: 'Slicing failed' + hint, details: err.message });
  } finally {
    unlink(rawPath).catch(() => {});
    unlink(stlPath).catch(() => {});
    unlink(gcodePath).catch(() => {});
  }
});

// ── Slice + Upload (for batch processing, returns JSON status) ──
app.post('/api/slice-and-upload', upload.single('stl'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No STL file uploaded' });

  const profile = req.body.profile || 'optimized';
  const rawPath = req.file.path;
  const stlPath = rawPath + '.stl';
  const gcodeFilename = req.body.filename
    ? req.body.filename.replace(/\.stl$/i, '.gcode')
    : 'output.gcode';
  const gcodePath = rawPath + '.gcode';

  const result = { gcode: false, drive: false, driveError: '' };
  let overridesPath = null;

  try {
    await rename(rawPath, stlPath);

    // Color-rule overrides (per-color slicer settings applied on top of the profile)
    if (req.body.overrides) {
      try {
        overridesPath = await writeOverridesIni(JSON.parse(req.body.overrides));
      } catch { /* invalid JSON — ignore */ }
    }
    const autoScale = req.body.autoScale !== '0';
    if (autoScale) {
      const targetX = 192, targetZ = 37;
      const targetY = req.body.hasInscription ? 48 : 42;
      await scaleSTL(stlPath, targetX, targetY, targetZ);
    } else {
      // Custom dimensions: apply only if all 3 are present and within range
      const clamp = n => Math.max(1, Math.min(300, n));
      const cx = parseFloat(req.body.customScaleX);
      const cy = parseFloat(req.body.customScaleY);
      const cz = parseFloat(req.body.customScaleZ);
      if ([cx, cy, cz].every(n => Number.isFinite(n) && n > 0)) {
        await scaleSTL(stlPath, clamp(cx), clamp(cy), clamp(cz));
      }
      // else: skip scaling entirely (use STL as-is)
    }
    // END TEMPORARY

    await runSlicer(profile, stlPath, gcodePath, overridesPath);

    result.gcode = true;

    // Read gcode and include in response (base64) so client can add to ZIP
    const gcodeBuf = await readFile(gcodePath);
    result.gcodeBase64 = gcodeBuf.toString('base64');
    result.gcodeFilename = gcodeFilename;

    // Upload to Google Drive
    const driveResult = await uploadToDrive(gcodePath, gcodeFilename);
    result.drive = driveResult.success;
    if (!driveResult.success) result.driveError = driveResult.reason || '';

    res.json(result);
  } catch (err) {
    console.error('Slice failed:', err.message);
    res.json(result); // gcode stays false
  } finally {
    unlink(rawPath).catch(() => {});
    unlink(stlPath).catch(() => {});
    unlink(gcodePath).catch(() => {});
    if (overridesPath) unlink(overridesPath).catch(() => {});
  }
});

// SPA fallback (Express 5 syntax)
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
