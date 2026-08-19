const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // .worktrees/* hold independent checkouts (see using-git-worktrees skill)
  // with their own node_modules — without this, running jest from the main
  // repo root picks up their test files too and hits duplicate-React errors.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.worktrees/'],
}

module.exports = createJestConfig(customJestConfig)
