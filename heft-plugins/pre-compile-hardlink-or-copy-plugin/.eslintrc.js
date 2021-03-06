// This is a workaround for https://github.com/eslint/eslint/issues/3458
require('@rushstack/eslint-config/patch/modern-module-resolution');

module.exports = {
  extends: ['@rushstack/eslint-config'],
  parserOptions: { tsconfigRootDir: __dirname },

  // TODO: Remove this once "tsdoc/syntax" is enabled by default
  rules: { 'tsdoc/syntax': 'error' }
};
