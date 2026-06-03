const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const productFilename = context.packager.appInfo.productFilename;
  const infoPlist = path.join(context.appOutDir, `${productFilename}.app`, "Contents", "Info.plist");

  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", "Delete :LSEnvironment", infoPlist], {
      stdio: "ignore",
    });
  } catch (error) {
    if (error.status !== 1) throw error;
  }
};
