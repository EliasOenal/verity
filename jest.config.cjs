module.exports = {
    preset: 'ts-jest',
    transform: {
      '^.+\\.ts$': 'ts-jest',
    },
    testEnvironment: 'node',
    testTimeout: 15000,
    runner: 'jest-runner',
    maxWorkers: 8, // Number of parallel processes for running test suites
    modulePathIgnorePatterns: ["<rootDir>/dist/"]
  };
  

  
  