import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

/** Inline plugin: import .md files as string default exports. */
function mdPlugin() {
  return {
    name: 'md',
    transform(code, id) {
      if (id.endsWith('.md')) {
        return { code: `export default ${JSON.stringify(code)};`, map: null };
      }
    },
  };
}

export default [
  // ESM build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/voice-sdk.esm.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins: [
      mdPlugin(),
      resolve(),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json', declaration: true, declarationDir: 'dist' }),
    ],
  },
  // IIFE build — for <script> tag usage
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/voice-sdk.iife.js',
      format: 'iife',
      name: 'VoiceSDKBundle',
      sourcemap: true,
      footer: 'if(typeof window!=="undefined"){window.VoiceSDK=VoiceSDKBundle.VoiceSDK;}',
    },
    plugins: [
      mdPlugin(),
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json', declaration: false, declarationDir: undefined }),
      terser(),
    ],
  },
];
