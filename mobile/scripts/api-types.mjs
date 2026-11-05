// Generates src/api/schema.d.ts from the API's OpenAPI contract, so the app's request and
// response types are always the server's. The contract is written by the API
// (`uv run python -m app.cli export-openapi`, checked by its tests); the first line of the
// output records the contract's hash, which tests/api.test.mjs compares, so a stale file fails.
//
// Usage: npm run api:types
// openapi-typescript is pinned and run through npx: its TypeScript peer range trails ours.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = join(root, "..", "contracts", "openapi.json");
const output = join(root, "src", "api", "schema.d.ts");

// One command string: on Windows npx is a .cmd, which only runs through a shell.
const result = spawnSync(
  `npx --yes openapi-typescript@7.13.0 "${contract}" -o "${output}"`,
  { stdio: "inherit", shell: true },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const hash = createHash("sha256").update(readFileSync(contract)).digest("hex");
const generated = readFileSync(output, "utf8");
writeFileSync(output, `// contracts/openapi.json sha256: ${hash}\n${generated}`);
console.log(`Wrote ${output}`);
