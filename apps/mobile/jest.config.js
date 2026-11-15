module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.tsx'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    // @logm8/rules-engine sources import siblings with ".js" suffixes.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
