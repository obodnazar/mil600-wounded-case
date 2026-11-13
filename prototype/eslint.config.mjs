import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended, {
  files: ['security/**/*.ts'],
  rules: {'@typescript-eslint/no-explicit-any': 'error'}
});
