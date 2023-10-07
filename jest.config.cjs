module.exports = {
    preset: 'ts-jest',
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
      '^.+\\.ts$': [
        'ts-jest',
        { useESM: true}
      ]
    },
    testEnvironment: 'node',
    testTimeout: 15000,
    runner: 'jest-runner',
    maxWorkers: 8, // Number of parallel processes for running test suites
    modulePathIgnorePatterns: ["<rootDir>/dist/"]
  };



