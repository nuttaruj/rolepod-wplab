import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/rolepod-wplab': 'src/bin/rolepod-wplab.ts',
  },
  format: ['esm'],
  target: 'node20',
  splitting: false,
  // Sourcemaps disabled for shipped builds — they account for ~10MB (68%) of
  // dist on a binary that end users `npx` and rarely inspect. Local devs can
  // re-enable via `tsup --sourcemap` ad-hoc, or by cloning the repo (where
  // `npm run build` honors a SOURCEMAP=1 env via the dev script if needed).
  sourcemap: false,
  clean: true,
  dts: true,
  shims: true,
  treeshake: true,
  banner: ({ format }) =>
    format === 'esm' ? { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } : {},
})
