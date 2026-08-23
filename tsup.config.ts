import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'device-transport-kit-node-hid/index':
      'src/device-transport-kit-node-hid/index.ts',
    'uuid/index': 'src/uuid/index.ts',
  },
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
  // esbuild preserves `with { imports: ... }`, but not under `target: 'node20'`, which
  // predates import attributes and drops them silently. bare.js needs no compiling, so copy
  // it through verbatim rather than building it.
  onSuccess: 'cp src/uuid/bare.js dist/uuid/bare.js',
})
