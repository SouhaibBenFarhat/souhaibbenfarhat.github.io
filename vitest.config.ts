import { defineConfig } from 'vitest/config';

// Standalone vite config rather than Astro's getViteConfig: the only things under test are plain
// React islands — no Astro or Tailwind pipeline, and no coupling to their vite versions. JSX is
// transformed per the root tsconfig (jsx: react-jsx), which Vitest's transform reads directly.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    restoreMocks: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // The widget reads PUBLIC_CHAT_API at module scope; pin it so URL assertions are exact.
    env: { PUBLIC_CHAT_API: 'https://api.test' },
  },
});
