import { build } from 'esbuild';

  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/index.mjs',
    sourcemap: true,
    packages: 'external',
  });

  console.log('Build complete');
  