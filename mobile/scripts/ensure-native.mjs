// Keeps the generated native project (Continuous Native Generation) in step with
// its inputs. `expo run:<platform>` only runs prebuild when the native folder is
// missing, so a plugin, app config, or native-package change would otherwise
// leave a stale project (e.g. the wrong minSdkVersion) without any warning.
//
// Expo's fingerprint hashes everything that shapes the native project: app.json
// and its config plugins, and every autolinked native package. The project is
// regenerated only when that hash changes, so ordinary builds stay incremental.
//
// Usage: node scripts/ensure-native.mjs <android|ios> [--force]

import { createFingerprintAsync } from "@expo/fingerprint";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platform = process.argv[2];
const force = process.argv.includes("--force");
if (platform !== "android" && platform !== "ios") {
  console.error("Usage: node scripts/ensure-native.mjs <android|ios> [--force]");
  process.exit(1);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeDir = join(projectRoot, platform);
// Stored inside the generated folder, so deleting the folder also resets it.
const stampFile = join(nativeDir, ".native-fingerprint");

const { hash } = await createFingerprintAsync(projectRoot, {
  platforms: [platform],
  // The generated folder is an output of the fingerprint, never an input.
  ignorePaths: ["android/**/*", "ios/**/*"],
  // Local config plugins shape the native project too; editing one must regenerate it.
  extraSources: [
    { type: "dir", filePath: "plugins", reasons: ["localConfigPlugins"] },
  ],
});

const previous = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : null;
if (!force && previous === hash) {
  console.log(`› Native ${platform} project is up to date (${hash.slice(0, 12)}).`);
  process.exit(0);
}

console.log(
  previous
    ? `› Native config or native packages changed; regenerating ${platform}/.`
    : `› No record of how ${platform}/ was generated; regenerating it.`,
);
// Run the project's own Expo CLI with this Node binary: no shell, same on every OS.
const expoCli = createRequire(join(projectRoot, "package.json")).resolve("expo/bin/cli");
const result = spawnSync(
  process.execPath,
  [expoCli, "prebuild", "--platform", platform, "--clean", "--no-install"],
  { cwd: projectRoot, stdio: "inherit" },
);
if (result.status !== 0) {
  console.error(`✖ expo prebuild failed (exit ${result.status ?? result.signal}).`);
  process.exit(result.status ?? 1);
}
writeFileSync(stampFile, `${hash}\n`);
console.log(`› Native ${platform} project regenerated (${hash.slice(0, 12)}).`);
