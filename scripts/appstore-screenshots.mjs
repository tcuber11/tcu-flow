// node scripts/appstore-screenshots.mjs   (with `npm run dev` serving the preview on :1420)
// App Store screenshots of the phone UI from the design preview (.preview, mocked IPC): iPhone 6.3" (1206×2622, the size App Store Connect asks for first)
// and iPad 13" (2064×2752), through Chrome's DevTools protocol for exact device emulation, into docs/appstore/.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../docs/appstore/", import.meta.url));
const BASE = "http://localhost:1420/.preview/index.html?version=9.9.9&theme=dark";
const DEVICES = [
  { name: "iphone", phone: "ios", w: 402, h: 874, scale: 3, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" },
  { name: "ipad", phone: "ipad", w: 1032, h: 1376, scale: 2, ua: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" },
];
const SCREENS = [
  ["1-computers", "scenario=linked"],
  ["2-touchpad", "scenario=linked&tap=Use%20as%20touchpad"],
  ["3-pair", "scenario=incoming"],
];

async function shot(out, url, w, h, scale, ua) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "about:blank",
  ], { stdio: "ignore" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const waiting = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) waiting.get(m.id)(m.result ?? m.error);
    });
    const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: +scale, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Network.setUserAgentOverride", { userAgent: ua });
    await send("Page.enable");
    await send("Page.navigate", { url });
    await sleep(6000);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    ws.close();
  } finally {
    chrome.kill();
  }
}

mkdirSync(OUT, { recursive: true });
for (const d of DEVICES)
  for (const [name, query] of SCREENS) {
    await shot(join(OUT, `${d.name}-${name}.png`), `${BASE}&phone=${d.phone}&${query}`, d.w, d.h, d.scale, d.ua);
    console.log(`${d.name}-${name}.png`);
  }
