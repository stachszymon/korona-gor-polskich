import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'app',
          globals: true,
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
          css: false,
        },
      },
      {
        test: {
          name: 'pipeline',
          globals: true,
          environment: 'node',
          include: ['pipeline/test/**/*.test.ts'],
        },
      },
    ],
  },
});
