import tseslint from 'typescript-eslint';

const SOURCES = ['security/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts', 'ui/**/*.ts', 'ui/**/*.tsx', 'e2e/**/*.ts'];

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: SOURCES,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Код має читатися під час рев'ю: без «стиснутих» рядків і функцій-велетнів.
      'max-len': ['error', {code: 140, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true}],
      complexity: ['error', 20],
    },
  },
  {
    // Тести містять довгі SQL-рядки й сценарії; складність там не обмежуємо.
    // `security/server.ts` — окремий тестовий адаптер фази 7 з одним лінійним обробником.
    files: ['**/*.test.ts', 'server/tests/**/*.ts', 'e2e/**/*.ts', 'security/server.ts'],
    rules: {complexity: 'off', 'max-len': ['error', {code: 190, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true}]},
  },
);
