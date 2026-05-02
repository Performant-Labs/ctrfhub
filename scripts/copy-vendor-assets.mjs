/**
 * Copies vendor front-end assets from node_modules to src/assets/
 * so @fastify/static can serve them under /assets/.
 *
 * Run as: node scripts/copy-vendor-assets.mjs
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dest = resolve(root, 'src', 'assets');

// Ensure destination exists
mkdirSync(dest, { recursive: true });

// Vendor JS files to copy
const assets = [
  ['node_modules/htmx.org/dist/htmx.min.js', 'htmx.min.js'],
  ['node_modules/idiomorph/dist/idiomorph-ext.min.js', 'idiomorph-ext.min.js'],
  ['node_modules/alpinejs/dist/cdn.min.js', 'alpine.min.js'],
  ['node_modules/flowbite/dist/flowbite.min.js', 'flowbite.min.js'],
];

for (const [src, name] of assets) {
  const srcPath = resolve(root, src);
  const destPath = resolve(dest, name);
  copyFileSync(srcPath, destPath);
  console.log(`Copied ${src} → src/assets/${name}`);
}

// Compile client TypeScript to browser-ready ES module.
// `initFlowbite` is referenced as a global (loaded via <script> in the
// layout), so `flowbite` must be external to avoid bundling it.
await build({
  entryPoints: [resolve(root, 'src', 'client', 'app.ts')],
  outfile: resolve(dest, 'app.js'),
  format: 'esm',
  bundle: true,
  external: ['flowbite'],
  target: 'es2022',
  minify: false,
});

console.log('Compiled src/client/app.ts → src/assets/app.js');
