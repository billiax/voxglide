import { defineConfig, type Plugin } from 'vitest/config';
import { readFileSync } from 'fs';

/** Import .md files as string default exports (mirrors rollup mdPlugin). */
function mdPlugin(): Plugin {
  return {
    name: 'md',
    transform(_code, id) {
      if (id.endsWith('.md')) {
        const content = readFileSync(id, 'utf-8');
        return { code: `export default ${JSON.stringify(content)};`, map: null };
      }
    },
  };
}

export default defineConfig({
  plugins: [mdPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/ui/styles.ts', 'src/ui/icons.ts'],
    },
  },
});
