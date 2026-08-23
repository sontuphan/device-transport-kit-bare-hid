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
  // esbuild strips import attributes, which would drop the `with { imports: ... }` that makes
  // uuid resolve under Bare. bare.js needs no compiling, so copy it through verbatim.
  onSuccess: 'cp src/uuid/bare.js dist/uuid/bare.js',
})
