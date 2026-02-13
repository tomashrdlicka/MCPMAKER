import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

mkdirSync(dist, { recursive: true });

// Copy public files to dist
cpSync(resolve(root, 'public'), dist, {
  recursive: true,
  force: true,
});

// Strip "export {};" from content-script.js since it runs as a non-module script
const contentScriptPath = resolve(dist, 'content-script.js');
try {
  let content = readFileSync(contentScriptPath, 'utf-8');
  content = content.replace(/^export\s*\{\s*\}\s*;?\s*$/gm, '// (module marker stripped for content script)');
  writeFileSync(contentScriptPath, content, 'utf-8');
  console.log('Stripped export from content-script.js');
} catch (e) {
  // content-script.js might not exist yet
}

// Strip "export {};" from popup.js since it runs via script tag (type=module handles it, but clean up)
// popup.html loads popup.js as type="module" so export {} is fine there

console.log('Public files copied to dist/');
