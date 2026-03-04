import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const external = ['@google/genai'];

export default [
  // ESM build — @google/genai is external (peer dep)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/voice-sdk.esm.js',
      format: 'esm',
      sourcemap: true,
    },
    external,
    plugins: [
      resolve(),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json', declaration: true, declarationDir: 'dist' }),
    ],
  },
  // IIFE build — bundles everything for <script> tag usage
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/voice-sdk.iife.js',
      format: 'iife',
      name: 'VoiceSDKBundle',
      sourcemap: true,
      // Expose VoiceSDK as a global
      footer: 'if(typeof window!=="undefined"){window.VoiceSDK=VoiceSDKBundle.VoiceSDK;}',
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json', declaration: false }),
      terser(),
    ],
  },
];
