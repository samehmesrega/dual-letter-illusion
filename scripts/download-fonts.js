#!/usr/bin/env node
/**
 * scripts/download-fonts.js
 * Downloads the 20 new Google Fonts as TTF files into public/fonts/
 * Usage:  node scripts/download-fonts.js
 */

import https from 'https';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts');

const FONTS = [
  { family: 'Archivo Black',    weight: 400, file: 'ArchivoBlack-Regular.ttf'    },
  { family: 'Fjalla One',       weight: 400, file: 'FjallaOne-Regular.ttf'       },
  { family: 'Righteous',        weight: 400, file: 'Righteous-Regular.ttf'       },
  { family: 'Squada One',       weight: 400, file: 'SquadaOne-Regular.ttf'       },
  { family: 'Titan One',        weight: 400, file: 'TitanOne-Regular.ttf'        },
  { family: 'Ultra',            weight: 400, file: 'Ultra-Regular.ttf'           },
  { family: 'Bangers',          weight: 400, file: 'Bangers-Regular.ttf'         },
  { family: 'Permanent Marker', weight: 400, file: 'PermanentMarker-Regular.ttf' },
  { family: 'Lobster',          weight: 400, file: 'Lobster-Regular.ttf'         },
  { family: 'Fredoka One',      weight: 400, file: 'FredokaOne-Regular.ttf'      },
  { family: 'Josefin Sans',     weight: 700, file: 'JosefinSans-Bold.ttf'        },
  { family: 'Exo 2',            weight: 700, file: 'Exo2-Bold.ttf'              },
  { family: 'DM Sans',          weight: 700, file: 'DMSans-Bold.ttf'            },
  { family: 'Manrope',          weight: 800, file: 'Manrope-ExtraBold.ttf'      },
  { family: 'Syne',             weight: 800, file: 'Syne-ExtraBold.ttf'         },
  { family: 'Kanit',            weight: 700, file: 'Kanit-Bold.ttf'             },
  { family: 'Barlow Condensed', weight: 700, file: 'BarlowCondensed-Bold.ttf'   },
  { family: 'Chakra Petch',     weight: 700, file: 'ChakraPetch-Bold.ttf'       },
  { family: 'Orbitron',         weight: 700, file: 'Orbitron-Bold.ttf'          },
  { family: 'Audiowide',        weight: 400, file: 'Audiowide-Regular.ttf'      },
  // Mono fonts (similar to Overpass Mono Bold)
  { family: 'Space Mono',       weight: 700, file: 'SpaceMono-Bold.ttf'         },
  { family: 'Roboto Mono',      weight: 700, file: 'RobotoMono-Bold.ttf'        },
  { family: 'Source Code Pro',   weight: 700, file: 'SourceCodePro-Bold.ttf'     },
  { family: 'IBM Plex Mono',    weight: 700, file: 'IBMPlexMono-Bold.ttf'       },
  { family: 'JetBrains Mono',   weight: 700, file: 'JetBrainsMono-Bold.ttf'     },
  { family: 'Fira Mono',        weight: 700, file: 'FiraMono-Bold.ttf'          },
  { family: 'Share Tech Mono',  weight: 400, file: 'ShareTechMono-Regular.ttf'  },
  { family: 'Oxygen Mono',      weight: 400, file: 'OxygenMono-Regular.ttf'     },
  { family: 'Ubuntu Mono',      weight: 700, file: 'UbuntuMono-Bold.ttf'        },
  { family: 'PT Mono',          weight: 400, file: 'PTMono-Regular.ttf'         },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFont({ family, weight, file }) {
  const dest = path.join(FONTS_DIR, file);
  if (fs.existsSync(dest)) {
    console.log(`  skip  ${file}  (already exists)`);
    return;
  }

  // 1. Google Fonts CSS v2 with NO User-Agent → returns direct TTF src URL
  const q   = encodeURIComponent(family);
  const css = (await httpsGet(
    `https://fonts.googleapis.com/css2?family=${q}:wght@${weight}&display=swap`
  )).body.toString();

  // 2. Extract TTF URL
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/i);
  if (!match) throw new Error(`No TTF URL found. CSS:\n${css.slice(0, 300)}`);

  // 3. Download binary font
  const { status, body } = await httpsGet(match[1]);
  if (status !== 200) throw new Error(`Font download returned HTTP ${status}`);

  fs.writeFileSync(dest, body);
  console.log(`  OK    ${file}  (${(body.length / 1024).toFixed(0)} KB)`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true });
  console.log(`Downloading ${FONTS.length} fonts → ${FONTS_DIR}\n`);

  let ok = 0, fail = 0;
  for (const font of FONTS) {
    process.stdout.write(`${font.file}... `);
    try {
      await downloadFont(font);
      ok++;
    } catch (err) {
      console.error(`FAILED: ${err.message.split('\n')[0]}`);
      fail++;
    }
  }
  console.log(`\nDone: ${ok} OK, ${fail} failed.`);
}

main();
