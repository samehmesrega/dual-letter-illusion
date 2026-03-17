import express from 'express';
import multer from 'multer';
import { execFile } from 'child_process';
import { readFile, writeFile, rename, unlink, readdir } from 'fs/promises';
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
const PROFILES_DIR = join(__dirname, 'slicer-profiles');

// ── Slicer configurations ──
const SLICERS = {
  'prusa-slicer': {
    name: 'PrusaSlicer',
    cmd: 'prusa-slicer',
    profileExt: '.ini',
    buildArgs(profilePath, supportPath, stlPath, gcodePath) {
      return [
        '--export-gcode',
        '--load', profilePath,
        '--load', supportPath,
        '--center', '112.5,112.5',
        '--output', gcodePath,
        stlPath
      ];
    }
  },
  'orca-slicer': {
    name: 'OrcaSlicer',
    cmd: 'orca-slicer',
    profileExt: '.json',
    useOrcaMode: true
  },
  'super-slicer': {
    name: 'SuperSlicer',
    cmd: 'superslicer',
    profileExt: '.ini',
    buildArgs(profilePath, supportPath, stlPath, gcodePath) {
      return [
        '--export-gcode',
        '--load', profilePath,
        '--load', supportPath,
        '--center', '112.5,112.5',
        '--output', gcodePath,
        stlPath
      ];
    }
  },
  'cura': {
    name: 'Cura',
    cmd: 'CuraEngine',
    profileExt: '.json',
    buildArgs(profilePath, _supportPath, stlPath, gcodePath) {
      // Cura uses -s key=value flags; read profile JSON and build args
      return { profilePath, stlPath, gcodePath };
    }
  }
};

// ── Google Drive upload via OAuth2 refresh token ──
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
let driveClient = null;

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
  if (!driveClient || !DRIVE_FOLDER_ID) return { success: false, reason: 'Drive not configured' };
  try {
    await driveClient.files.create({
      requestBody: { name: filename, parents: [DRIVE_FOLDER_ID] },
      media: { mimeType: 'application/octet-stream', body: createReadStream(filePath) }
    });
    console.log(`Uploaded to Drive: ${filename}`);
    return { success: true };
  } catch (e) {
    console.error('Drive upload failed:', e.message);
    return { success: false, reason: e.message };
  }
}

// ── Run a slicer to produce G-code ──
async function runSlicer(slicerId, profileName, stlPath, gcodePath) {
  const slicer = SLICERS[slicerId];
  if (!slicer) throw new Error(`Unknown slicer: ${slicerId}`);

  const slicerDir = join(PROFILES_DIR, slicerId);

  if (slicerId === 'cura') {
    // Cura: read JSON profile and build -s flags
    // IMPORTANT: global settings must come BEFORE -l (model), per-mesh settings after -l
    const profilePath = join(slicerDir, `${profileName}.json`);
    const printerDef = '/opt/cura-definitions/fdmprinter.def.json';
    const profileData = JSON.parse(await readFile(profilePath, 'utf8'));
    const args = ['slice', '-j', printerDef, '-o', gcodePath];
    // Machine dimensions (Elegoo Neptune 4 Pro)
    args.push('-s', 'machine_width=225', '-s', 'machine_depth=225', '-s', 'machine_height=265');
    // Global print settings from profile
    for (const [key, value] of Object.entries(profileData.settings || {})) {
      args.push('-s', `${key}=${value}`);
    }
    // Load model (CuraEngine auto-centers on bed, scaleSTL already centered at origin)
    args.push('-l', stlPath);

    return new Promise((resolve, reject) => {
      execFile(slicer.cmd, args, {
        timeout: 120_000,
        env: { ...process.env, CURA_ENGINE_SEARCH_PATH: '/opt/cura-definitions' }
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }

  if (slicer.useOrcaMode) {
    // OrcaSlicer: completely different CLI from PrusaSlicer
    // Uses --load-settings "machine.json;process.json" --load-filaments "filament.json"
    // Outputs .gcode.3mf (ZIP), need to extract .gcode from it
    const machineJson = join(slicerDir, 'machine.json');
    const processJson = join(slicerDir, `${profileName}.json`);
    const filamentJson = join(slicerDir, 'filament.json');
    const threemfPath = stlPath + '.output.3mf';

    const args = [
      '--load-settings', `${machineJson};${processJson}`,
      '--load-filaments', filamentJson,
      '--slice', '0',
      '--export-3mf', threemfPath,
      '--arrange', '0',
      stlPath
    ];

    return new Promise((resolve, reject) => {
      execFile(slicer.cmd, args, { timeout: 120_000 }, async (err, stdout, stderr) => {
        if (err) {
          unlink(threemfPath).catch(() => {});
          return reject(new Error(stderr || stdout || err.message));
        }
        // Extract .gcode from the 3mf ZIP
        try {
          await new Promise((res, rej) => {
            execFile('unzip', ['-o', '-j', threemfPath, '*.gcode', '-d', dirname(gcodePath)],
              { timeout: 30_000 }, async (e, o, se) => {
                if (e) return rej(new Error(se || e.message));
                // Find extracted gcode and rename to expected path
                const files = await readdir(dirname(gcodePath));
                const gcFile = files.find(f => f.endsWith('.gcode') && !f.startsWith('.'));
                if (gcFile) {
                  const extractedPath = join(dirname(gcodePath), gcFile);
                  if (extractedPath !== gcodePath) await rename(extractedPath, gcodePath);
                }
                res(o);
              });
          });
          resolve(stdout);
        } catch (extractErr) {
          reject(new Error(`3MF extraction failed: ${extractErr.message}`));
        } finally {
          unlink(threemfPath).catch(() => {});
        }
      });
    });
  }

  // .ini profile slicers (PrusaSlicer / SuperSlicer)
  const profilePath = join(slicerDir, `${profileName}.ini`);
  const supportPath = join(slicerDir, 'support-override.ini');

  // PrusaSlicer / SuperSlicer: use --export-gcode
  const args = slicer.buildArgs(profilePath, supportPath, stlPath, gcodePath);

  return new Promise((resolve, reject) => {
    execFile(slicer.cmd, args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
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

// ── List available slicers ──
app.get('/api/slicers', (_req, res) => {
  const list = Object.entries(SLICERS).map(([id, s]) => ({ id, name: s.name }));
  res.json(list);
});

// ── List available profiles for a slicer ──
app.get('/api/profiles', async (req, res) => {
  const slicerId = req.query.slicer || 'prusa-slicer';
  const slicer = SLICERS[slicerId];
  if (!slicer) return res.json([]);

  try {
    const slicerDir = join(PROFILES_DIR, slicerId);
    const files = await readdir(slicerDir);
    const ext = slicer.profileExt;
    const profiles = files
      .filter(f => f.endsWith(ext) && !f.startsWith('support') && !f.startsWith('printer') && !f.startsWith('machine') && !f.startsWith('filament'))
      .map(f => ({
        id: f.replace(ext, ''),
        name: f.replace(ext, '').replace(/_/g, ' ')
      }));
    res.json(profiles);
  } catch {
    res.json([]);
  }
});

// ── Slice STL → G-code ──
app.post('/api/slice', upload.single('stl'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No STL file uploaded' });

  const slicerId = req.body.slicer || 'prusa-slicer';
  const profile = req.body.profile || 'default';
  const rawPath = req.file.path;
  const stlPath = rawPath + '.stl';
  const gcodeFilename = req.body.filename
    ? req.body.filename.replace(/\.stl$/i, '.gcode')
    : 'output.gcode';
  const gcodePath = rawPath + '.gcode';

  try {
    await rename(rawPath, stlPath);

    const targetX = 192, targetZ = 37;
    const targetY = req.body.hasInscription ? 48 : 42;
    await scaleSTL(stlPath, targetX, targetY, targetZ);

    await runSlicer(slicerId, profile, stlPath, gcodePath);

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
    res.status(500).json({ error: 'Slicing failed', details: err.message });
  } finally {
    unlink(rawPath).catch(() => {});
    unlink(stlPath).catch(() => {});
    unlink(gcodePath).catch(() => {});
  }
});

// ── Slice + Upload (for batch processing, returns JSON status) ──
app.post('/api/slice-and-upload', upload.single('stl'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No STL file uploaded' });

  const slicerId = req.body.slicer || 'prusa-slicer';
  const profile = req.body.profile || 'default';
  const rawPath = req.file.path;
  const stlPath = rawPath + '.stl';
  const gcodeFilename = req.body.filename
    ? req.body.filename.replace(/\.stl$/i, '.gcode')
    : 'output.gcode';
  const gcodePath = rawPath + '.gcode';

  const result = { gcode: false, drive: false, driveError: '' };

  try {
    await rename(rawPath, stlPath);

    const targetX = 192, targetZ = 37;
    const targetY = req.body.hasInscription ? 48 : 42;
    await scaleSTL(stlPath, targetX, targetY, targetZ);

    await runSlicer(slicerId, profile, stlPath, gcodePath);

    result.gcode = true;

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
  }
});

// SPA fallback (Express 5 syntax)
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
