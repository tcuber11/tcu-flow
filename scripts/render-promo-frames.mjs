// node scripts/render-promo-frames.mjs <outDir> <fromSec> <toSec> [id|en]
// Renders site/promo/index.html frame by frame (30 fps, 1920x1080) through ONE headless Chrome over the DevTools
// protocol: the page loads once (fonts included), then every frame is `render(t)` plus a screenshot. Minutes instead
// of hours compared with launching Chrome per frame. Frames already on disk are kept. Used by scripts/render-promo.sh.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [outDir, fromArg, toArg, lang = "id"] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: render-promo-frames.mjs <outDir> <fromSec> <toSec> [id|en]");
  process.exit(2);
}
const FPS = 30;
const from = Number(fromArg ?? 0), to = Number(toArg ?? 46);
const n = Math.round((to - from) * FPS);
const page = pathToFileURL(resolve(fileURLToPath(new URL("../site/promo/index.html", import.meta.url)))).href + `?t=0${lang === "en" ? "&lang=en" : ""}`;
const chromePath = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(outDir, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "promo-"))}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  if (!target) throw new Error("Chrome did not come up");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    waiting.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: page });
  // the page marks itself ready once its fonts are in and the first frame is drawn
  for (let i = 0; i < 100 && (await evaluate("document.body && document.body.dataset.ready === '1'")) !== true; i++) await sleep(200);
  if ((await evaluate("document.body.dataset.ready")) !== "1") throw new Error("the promo page never became ready");

  let done = 0;
  for (let i = 0; i < n; i++) {
    const file = join(outDir, `f${String(i).padStart(5, "0")}.png`);
    if (existsSync(file) && statSync(file).size > 0) continue;
    const t = Math.round((from + i / FPS) * 10000) / 10000;
    // render, then let the compositor draw it (two animation frames) before the capture
    await evaluate(`render(${t}); true`);
    await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    if (++done % 150 === 0) console.log(`  ${i + 1} / ${n}`);
  }
  console.log(`${n} frames in ${outDir} (${done} rendered now)`);
  ws.close();
} finally {
  chrome.kill();
}
