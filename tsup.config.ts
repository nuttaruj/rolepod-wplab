import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/rolepod-wplab': 'src/bin/rolepod-wplab.ts',
  },
  format: ['esm'],
  target: 'node20',
  // ssh2 (pulled in by node-ssh for SshTarget) ships an OPTIONAL native addon
  // (sshcrypto.node via nan, plus cpu-features). Bundling it makes esbuild try
  // to resolve that .node at build time — fine on a host where node-gyp built
  // it, but it hard-fails in the alpine Docker build where no native toolchain
  // is present. Keep ssh2 + its native optionals external: they resolve from
  // node_modules at runtime, where ssh2 already falls back to pure JS if the
  // addon is missing. node-ssh + ssh2 are declared deps so npm installs them.
  external: ['ssh2', 'cpu-features'],
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
