module.exports = {
  preset: "jest-expo",
  testMatch: ["**/tests/**/*.component.test.tsx"],
  modulePathIgnorePatterns: [
    "<rootDir>/.tmp/",
    "<rootDir>/android/",
    "<rootDir>/outputs/",
  ],
};
