// Inline styles.css and app.js into index.html -> standalone.html (a single-file copy of the site).
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('styles.css', 'utf8');
const js = readFileSync('app.js', 'utf8');

const out = html
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
  .replace('<script src="app.js" defer></script>', () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}</script>`);

writeFileSync('standalone.html', out);
