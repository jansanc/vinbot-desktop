// electron-builder afterPack: drop what Electron ships that this app never uses.
//
// dxcompiler.dll and dxil.dll are DirectX's shader compiler, which Chromium
// loads only for WebGPU on Windows (~26 MB). The window is a plain React page;
// nothing in it uses WebGPU.
const fs = require("fs");
const path = require("path");

const UNUSED_WINDOWS_FILES = ["dxcompiler.dll", "dxil.dll"];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  for (const file of UNUSED_WINDOWS_FILES) {
    const target = path.join(context.appOutDir, file);
    if (fs.existsSync(target)) {
      fs.rmSync(target);
      console.log(`  • removed unused ${file}`);
    }
  }
};
