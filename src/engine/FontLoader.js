import opentype from 'opentype.js';

const fontCache = new Map();

/**
 * Load a TTF font from a URL, parse with opentype.js, cache the result.
 * @param {string} url - URL to the TTF file
 * @returns {Promise<opentype.Font>}
 */
export function loadFont(url, retries = 1) {
  if (fontCache.has(url)) return Promise.resolve(fontCache.get(url));

  return new Promise((resolve, reject) => {
    function attempt(remaining) {
      opentype.load(url, (err, font) => {
        if (err) {
          if (remaining > 0) return attempt(remaining - 1);
          return reject(new Error(`Failed to load font "${url}": ${err.message || err}`));
        }
        fontCache.set(url, font);
        resolve(font);
      });
    }
    attempt(retries);
  });
}

/**
 * Parse a font from an ArrayBuffer (for fonts fetched via fetch()).
 * @param {ArrayBuffer} buffer
 * @param {string} key - Cache key
 * @returns {opentype.Font}
 */
export function loadFontFromBuffer(buffer, key) {
  if (fontCache.has(key)) return fontCache.get(key);
  const font = opentype.parse(buffer);
  fontCache.set(key, font);
  return font;
}

export function clearCache() {
  fontCache.clear();
}
