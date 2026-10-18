// Bundles a Node service (apps/mcp, apps/worker) into one ESM file, workspace packages
// included, so the Docker image ships dist/ plus the few native or dynamic dependencies.
import { build } from 'esbuild';

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error('usage: node scripts/bundle.mjs <entry.ts> <out.mjs>');
  process.exit(2);
}

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'linked',
  // pg loads pg-native lazily; it is never installed.
  external: ['pg-native'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
