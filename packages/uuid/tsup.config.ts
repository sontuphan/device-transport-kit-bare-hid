import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  // esbuild preserves `with { imports: ... }`, but not under a target that predates import
  // attributes, and it cannot represent them in CJS output at all. bare.js needs no
  // compiling, so copy it through verbatim rather than building it.
  onSuccess: 'cp bare.js dist/bare.js',
})
