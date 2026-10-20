// Expo config plugin: keep every Android module's CMake build tree in a short folder.
//
// Why: Windows limits paths to 260 characters unless long paths are enabled, and the
// ninja bundled with the Android SDK's CMake cannot see longer paths even then. By
// default each native module builds in `node_modules/<package>/android/.cxx/...`,
// and with long package names (e.g. react-native-vision-camera-worklets) the prefab
// config paths CMake depends on exceed the limit. Ninja then treats them as missing,
// re-runs CMake forever, and fails with "manifest 'build.ninja' still dirty after
// 100 tries". Building in `android/.cxx/<short id>` keeps those paths well under the
// limit regardless of package names. Harmless on macOS and Linux.
//
// It uses AGP's `androidComponents.finalizeDsl`, which runs after a module's own
// `android {}` block and before its tasks exist, so module settings are respected.

const { withProjectBuildGradle } = require("expo/config-plugins");

const MARKER = "mokhotsi:short-native-build-dirs";

const GRADLE = `
// @generated begin ${MARKER} - see mobile/plugins/with-short-native-build-dirs.js
subprojects { sub ->
  ["com.android.application", "com.android.library"].each { pluginId ->
    sub.plugins.withId(pluginId) {
      sub.extensions.getByName("androidComponents").finalizeDsl { android ->
        def cmake = android.externalNativeBuild.cmake
        if (cmake.path != null) {
          // One stable folder per module: its Gradle path's hash, 8 hex characters.
          cmake.buildStagingDirectory = new File(
            rootProject.projectDir, ".cxx/" + Integer.toHexString(sub.path.hashCode()))
        }
      }
    }
  }
}
// @generated end ${MARKER}
`;

module.exports = function withShortNativeBuildDirs(config) {
  return withProjectBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== "groovy")
      throw new Error(
        "with-short-native-build-dirs supports a Groovy android/build.gradle only.",
      );
    if (!gradle.modResults.contents.includes(MARKER))
      gradle.modResults.contents += GRADLE;
    return gradle;
  });
};
