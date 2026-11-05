// Electron main for the Mac VM test: runs the app's real login code (dist/)
// against the Firefox bundled in the installed app (copied to vendor/firefox).
const { app } = require("electron");
const path = require("path");
app.whenReady().then(async () => {
  const { InteractiveSessionExtractor } = require(path.resolve("dist/modules/vinted/session/interactiveSessionExtractor.js"));
  const ex = new InteractiveSessionExtractor();
  const t0 = Date.now();
  try {
    const r = await ex.interactiveLogin({
      url: "https://www.vinted.es/member/signup/select_type?ref_url=%2F",
      timeout: Number(process.env.LOGIN_TIMEOUT || 40),
      locale: "es",
      onStatus: (s) => console.log(`[test] status ${s} at ${Date.now() - t0}ms`),
    });
    console.log("[test] RESULT", JSON.stringify(r).slice(0, 300));
  } catch (e) {
    console.log(`[test] ERROR code=${e.code} message=${e.message} after ${Date.now() - t0}ms`);
  }
  app.quit();
});
