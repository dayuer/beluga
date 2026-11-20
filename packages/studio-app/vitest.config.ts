import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: false,
  },
  resolve: {
    alias: {
      'react-native': resolve(__dirname, 'test/rn-mock.ts'),
      'react-native-svg': resolve(__dirname, 'test/svg-mock.ts'),
      'lucide-react-native': resolve(__dirname, 'test/lucide-mock.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['lib/**/*.test.ts', 'components/**/*.test.tsx'],
    server: {
      deps: {
        inline: ['@testing-library/react-native'],
      },
    },
  },
});
