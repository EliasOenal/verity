// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**/*', 'distweb/**/*', 'node_modules/**/*']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        global: 'readonly'
      }
    }
  },
  {
    files: ['.eslintrc.cjs'],
    languageOptions: {
      globals: {
        module: 'readonly'
      }
    }
  },
  {
    files: ['src/webui/static/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        Blob: 'readonly'
      }
    }
  },
  {
    files: ['src/webui/static/serviceWorker.js'],
    languageOptions: {
      globals: {
        caches: 'readonly',
        self: 'readonly',
        fetch: 'readonly'
      }
    }
  }
);
