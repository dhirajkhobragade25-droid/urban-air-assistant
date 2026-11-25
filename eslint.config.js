/**
 * ESLint flat config. Self-contained (no plugins or shared configs to install):
 * run it with `npm run lint`, which uses `npx eslint`.
 */
const browser = Object.fromEntries(
  [
    'AbortController',
    'DOMMatrixReadOnly',
    'Element',
    'IntersectionObserver',
    'ResizeObserver',
    'URL',
    'URLSearchParams',
    'clearTimeout',
    'document',
    'getComputedStyle',
    'navigator',
    'performance',
    'requestAnimationFrame',
    'setTimeout',
    'window',
  ].map((name) => [name, 'readonly']),
);

const node = Object.fromEntries(['URL', 'clearTimeout', 'process', 'setTimeout'].map((name) => [name, 'readonly']));

const rules = {
  // Possible errors
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'after-used', ignoreRestSiblings: true }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-self-compare': 'error',
  'no-template-curly-in-string': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-constant-condition': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-promise-executor-return': 'error',
  'no-await-in-loop': 'error',
  'require-atomic-updates': 'off',
  // Safety
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-restricted-properties': [
    'error',
    { property: 'innerHTML', message: 'Set text with textContent; never parse data as markup.' },
    { property: 'outerHTML', message: 'Set text with textContent; never parse data as markup.' },
  ],
  // Clarity
  'eqeqeq': ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
  'object-shorthand': 'error',
  'prefer-template': 'error',
  'no-else-return': 'error',
  'no-lonely-if': 'error',
  'no-nested-ternary': 'error',
  'no-param-reassign': ['error', { props: false }],
  'no-shadow': 'error',
  'no-use-before-define': ['error', { functions: false }],
  'consistent-return': 'error',
  'default-param-last': 'error',
  'dot-notation': 'error',
  'curly': ['error', 'multi-line'],
  'complexity': ['error', 14],
  'max-depth': ['error', 3],
  'max-params': ['error', 5],
  'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
};

export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser },
    rules,
  },
  {
    // The string tables are data, not logic.
    files: ['js/locales/*.js'],
    rules: { 'max-lines': 'off' },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: node },
    rules: { ...rules, 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
];
