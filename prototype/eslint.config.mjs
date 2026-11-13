import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended, {
  files: ['security/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts', 'ui/**/*.ts', 'ui/**/*.tsx', 'e2e/**/*.ts'],
  rules: {'@typescript-eslint/no-explicit-any': 'error'}
});
