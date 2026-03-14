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

// ── Google Drive upload (fire-and-forget) ──
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
let driveClient = null;

if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  try {
    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    driveClient = google.drive({ version: 'v3', auth });
    console.log('Google Drive upload enabled');
  } catch (e) {
    console.warn('Google Drive setup failed:', e.message);
  }
}

async function uploadToDrive(filePath, filename) {
  if (!driveClient || !DRIVE_FOLDER_ID) return;
  try {
    await driveClient.files.create({
      requestBody: { name: filename, parents: [DRIVE_FOLDER_ID] },
      media: { mimeType: 'application/octet-stream', body: createReadStream(filePath) }
    });
    console.log(`Uploaded to Drive: ${filename}`);
  } catch (e) {
    console.error('Drive upload failed:', e.message);
  }
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

// ── List available slicer profiles ──
app.get('/api/profiles', async (_req, res) => {
  try {
    const files = await readdir(PROFILES_DIR);
    const profiles = files
      .filter(f => f.endsWith('.ini') && !f.startsWith('support'))
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

  const profile = req.body.profile || 'default';
  const profilePath = join(PROFILES_DIR, `${profile}.ini`);
  const rawPath = req.file.path;
  const stlPath = rawPath + '.stl';
  const gcodeFilename = req.body.filename
    ? req.body.filename.replace(/\.stl$/i, '.gcode')
    : 'output.gcode';
  const gcodePath = rawPath + '.gcode';

  try {
    // Rename temp file to .stl so PrusaSlicer recognizes the format
    await rename(rawPath, stlPath);

    // Non-uniform scale: read STL, compute per-axis factors, rewrite
    const targetX = 192, targetZ = 37;
    const targetY = req.body.hasInscription ? 48 : 42;
    await scaleSTL(stlPath, targetX, targetY, targetZ);

    await new Promise((resolve, reject) => {
      const supportPath = join(PROFILES_DIR, 'support-override.ini');
      execFile('prusa-slicer', [
        '--export-gcode',
        '--load', profilePath,
        '--load', supportPath,
        '--center', '112.5,112.5',
        '--output', gcodePath,
        stlPath
      ], { timeout: 120_000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });

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
    // Cleanup temp files
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
