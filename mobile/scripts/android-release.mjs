// Builds and installs a release APK for one CPU architecture only.
//
// Why: `expo run:android --variant release` builds native code for every ABI in
// android/gradle.properties (armeabi-v7a, arm64-v8a, x86, x86_64). Expo narrows that
// to the connected phone only for debug builds, so a release build compiles every
// C++ module (vision-camera, worklets, reanimated, Hermes...) four times. A test
// phone needs just one, which cuts the native work to about a quarter.
//
// The ABI comes from `--abi <name>`, else from the single connected device via adb,
// else arm64-v8a (nearly every current Android phone). Shop distribution builds that
// must also run on 32-bit phones should still build all ABIs.
//
// Usage: node scripts/android-release.mjs [--abi arm64-v8a] [--no-install]

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = join(projectRoot, "android");
const apk = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
const KNOWN_ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"];

const args = process.argv.slice(2);
const abiFlag = args.indexOf("--abi");
const install = !args.includes("--no-install");

function fail(message, code = 1) {
  console.error(`✖ ${message}`);
  process.exit(code);
}

// adb is often not on PATH; look in the SDK the way Expo does, then fall back to PATH.
const ADB = (() => {
  const exe = process.platform === "win32" ? "adb.exe" : "adb";
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Android", "Sdk")
      : null,
    process.platform === "darwin" && process.env.HOME
      ? join(process.env.HOME, "Library", "Android", "sdk")
      : null,
    process.platform === "linux" && process.env.HOME
      ? join(process.env.HOME, "Android", "Sdk")
      : null,
  ];
  for (const root of sdkRoots) {
    const candidate = root ? join(root, "platform-tools", exe) : null;
    if (candidate && existsSync(candidate)) return candidate;
  }
  return "adb";
})();

/** Runs adb and returns trimmed stdout, or null when adb is missing or fails. */
function adb(...adbArgs) {
  const result = spawnSync(ADB, adbArgs, { encoding: "utf8", timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Serials of devices that are connected and authorised. */
function connectedDevices() {
  const out = adb("devices");
  if (out === null) return [];
  return out
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
}

// Validate arguments before anything slow or that touches android/.
const requestedAbi = abiFlag === -1 ? null : args[abiFlag + 1];
if (requestedAbi !== null && !KNOWN_ABIS.includes(requestedAbi))
  fail(`--abi must be one of: ${KNOWN_ABIS.join(", ")}.`);

function resolveAbi(devices) {
  if (requestedAbi !== null) return requestedAbi;
  if (devices.length === 1) {
    const abi = adb("-s", devices[0], "shell", "getprop", "ro.product.cpu.abi");
    if (abi && KNOWN_ABIS.includes(abi)) {
      console.log(`› Connected device ${devices[0]} is ${abi}.`);
      return abi;
    }
  } else if (devices.length > 1) {
    fail("More than one device is connected; pass --abi <name> or unplug the others.");
  }
  console.log("› No device to ask; building for arm64-v8a.");
  return "arm64-v8a";
}

/** Runs a command in the foreground, exiting with its code if it fails. */
function run(label, command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? result.signal}).`, result.status ?? 1);
}

// Regenerate android/ first if its config or native packages changed.
run("Native project check", process.execPath, [join(projectRoot, "scripts", "ensure-native.mjs"), "android"], {
  cwd: projectRoot,
});

const devices = connectedDevices();
const abi = resolveAbi(devices);

// gradlew.bat needs a shell on Windows (Node refuses to spawn .bat files without one).
const windows = process.platform === "win32";
const started = Date.now();
run(
  "Gradle release build",
  windows ? "gradlew.bat" : "./gradlew",
  ["app:assembleRelease", `-PreactNativeArchitectures=${abi}`],
  { cwd: androidDir, shell: windows },
);
const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log(`› Built ${abi} release APK in ${minutes} min:\n  ${apk}`);

if (!install) process.exit(0);
if (!existsSync(apk)) fail(`Expected APK not found at ${apk}.`);
if (devices.length !== 1) {
  console.log("› No single connected device; install it later with:\n  adb install -r <path above>");
  process.exit(0);
}
run("adb install", ADB, ["-s", devices[0], "install", "-r", apk]);
console.log("› Installed. Open Mokhotsi on the phone.");
