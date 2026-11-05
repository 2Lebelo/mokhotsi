const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

// Layering (ADR 0005): each side effect has one home, so it can be reasoned about and tested.
// A later block replaces an earlier one's list for the files it matches, so each block names
// every import its files may not use.
const SQLITE = {
  name: "expo-sqlite",
  message: "Only src/db/ (and the provider that opens device.db) use SQLite.",
};
const SECURE_STORE = {
  name: "expo-secure-store",
  message: "Use src/auth/secure.ts: secrets have one home.",
};
const PLAIN = "src/lib/, src/sync/ and src/api/ are plain TypeScript, testable in node.";
const REACT = { name: "react", message: PLAIN };
const REACT_NATIVE = { name: "react-native", message: PLAIN };

const restrict = (files, paths) => ({
  files,
  rules: { "no-restricted-imports": ["error", { paths }] },
});

module.exports = defineConfig([
  expoConfig,
  restrict(["src/**/*.{ts,tsx}"], [SQLITE, SECURE_STORE]),
  restrict(["src/db/**", "src/auth/device-provider.tsx"], [SECURE_STORE]),
  restrict(["src/auth/secure.ts"], [SQLITE]),
  restrict(["src/lib/**", "src/sync/**", "src/api/**"], [REACT, REACT_NATIVE, SQLITE, SECURE_STORE]),
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/api/client.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Only src/api/client.ts talks to the network." },
      ],
    },
  },
  {
    // Native file, camera and model APIs become asynchronous between SDK releases; an
    // unawaited call then races whatever reads its result. `void` marks a deliberate one.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: __dirname },
    },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
  {
    ignores: [
      "dist/**",
      "android/**",
      "ios/**",
      "tests/**",
      "scripts/**",
      "verification/**",
    ],
  },
]);
