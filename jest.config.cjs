module.exports = {
  preset: 'ts-jest/presets/js-with-ts-esm',
  testEnvironment: 'node',
  testTimeout: 15000,
  runner: 'jest-runner',
  maxWorkers: 8, // Number of parallel processes for running test suites
  modulePathIgnorePatterns: ["<rootDir>/dist/"]
};



