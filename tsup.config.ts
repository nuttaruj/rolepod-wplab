import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/rolepod-wplab': 'src/bin/rolepod-wplab.ts',
  },
  format: ['esm'],
  target: 'node20',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  shims: true,
  treeshake: true,
  banner: ({ format }) =>
    format === 'esm' ? { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } : {},
})
