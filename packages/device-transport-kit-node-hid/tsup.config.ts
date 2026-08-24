import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'index.ts' },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep the wrapper external. Bundled, esbuild would inline its `default` branch and the
  // `bare` condition would never be evaluated at runtime.
  external: ['@tetherto/uuid'],
})
