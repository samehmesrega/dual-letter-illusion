import express from 'express';
import multer from 'multer';
import { execFile } from 'child_process';
import { readFile, rename, unlink, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: tmpdir() });
const PORT = process.env.PORT || 3001;

// Slicer profiles directory
const PROFILES_DIR = join(__dirname, 'slicer-profiles');

// Serve built static files
app.use(express.static(join(__dirname, 'dist')));

// ── List available slicer profiles ──
app.get('/api/profiles', async (_req, res) => {
  try {
    const files = await readdir(PROFILES_DIR);
    const profiles = files
      .filter(f => f.endsWith('.ini'))
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

    await new Promise((resolve, reject) => {
      execFile('prusa-slicer', [
        '--export-gcode',
        '--load', profilePath,
        '--scale-to-fit', '192x42x37',
        '--output', gcodePath,
        stlPath
      ], { timeout: 120_000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });

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
