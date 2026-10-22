'use strict';

// Static application security testing (SAST) rules, run in CI stage 2 via
// `npm run sast`. Every rule is an error so findings fail the pipeline.

const security = require('eslint-plugin-security');
const globals = require('globals');

const recommended = security.configs.recommended;

module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    plugins: recommended.plugins,
    rules: {
      ...Object.fromEntries(Object.keys(recommended.rules).map((rule) => [rule, 'error'])),
      // Bracket access with validated keys is pervasive and safe here: every
      // request field passes the schema validator (src/lib/validate.js), which
      // rejects unknown keys. This rule cannot see that and only produces noise.
      'security/detect-object-injection': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error'
    }
  }
];
