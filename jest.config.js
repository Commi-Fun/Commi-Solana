module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/app/src'],
  testMatch: [
    '<rootDir>/app/src/**/__tests__/**/*.ts',
    '<rootDir>/app/src/**/*.test.ts',
    '<rootDir>/app/src/**/*.spec.ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'app/src/**/*.ts',
    '!app/src/**/*.d.ts',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};