import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'public/**', 'ssr/**', 'dist/**', '.wrangler/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.worker,
      },
    },
    rules: {
      // 项目大量使用 any,暂不阻断
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);