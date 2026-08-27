import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  // esbuild cannot carry `with { imports: ... }` into every target or into CJS, and bare.js
  // needs no compiling, so copy it through verbatim.
  onSuccess: 'cp bare.js dist/bare.js',
})
