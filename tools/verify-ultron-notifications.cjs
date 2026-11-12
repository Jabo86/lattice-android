"use strict";
// A build-time guard: reject Firebase/FCM integration in our own Android source.
// Android's build toolchain may still use Google's Maven artifact repository;
// this script checks runtime app integration, not build-tool provenance.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");

const files = [
  "App.js", "index.js", "package.json", "app.json",
  "src/config.js", "src/lib/config.js", "src/lib/notifications.js",
  "src/lib/wake.js", "src/screens/SettingsScreen.js",
  "android/app/build.gradle", "android/build.gradle",
  "android/app/src/main/AndroidManifest.xml"
];
const forbidden = [
  /@react-native-firebase/i, /expo-notifications/i, /getDevicePushTokenAsync/,
  /googleServicesFile/, /com\\.google\\.gms\\.google-services/,
  /com\\.google\\.firebase/, /ExpoFirebaseMessagingService/,
  /firebase_messaging_notification_delegation_enabled/,
];
let errors = [];
for (const file of files) {
  const code = fs.readFileSync(path.resolve(file), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(code)) errors.push(file + ": forbidden " + pattern);
  }
}
const android = JSON.parse(fs.readFileSync("app.json", "utf8")).expo.android;
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(android.package, "com.ultron.messenger");
assert.equal(pkg.dependencies["@react-native-firebase/app"], undefined);
assert.equal(pkg.dependencies["@react-native-firebase/messaging"], undefined);
assert.equal(pkg.dependencies["expo-notifications"], undefined);
const js = fs.readFileSync("src/config.js", "utf8");
const native = fs.readFileSync("android/app/src/main/java/com/latticenetwork/pulse/WakeService.kt", "utf8");
if (!js.includes("https://49.12.242.0")) errors.push("Default server does not target ULTRON");
if (!native.includes("https://49.12.242.0")) errors.push("WakeService does not target ULTRON");
if (!native.includes("/api/public/wake/poll")) errors.push("WakeService endpoint mismatch");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("ULTRON native notification static checks passed (no end-to-end delivery verified).");
