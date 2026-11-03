// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
// node scripts/release.mjs v0.9.0
// After the installers are on the GitHub release (as today, plus the Mac's TCuFlow_universal.app.tar.gz from Codemagic):
// downloads them, signs each with the updater key, and uploads latest.json, which the in-app updater reads from
// releases/latest/download/latest.json. Key: TAURI_SIGNING_PRIVATE_KEY(_PASSWORD), else ~/.tauri/tcuflow.key(.password).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "tcuber11/tcu-flow";
const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("usage: node scripts/release.mjs v0.9.0");
  process.exit(1);
}

const keyFile = join(homedir(), ".tauri", "tcuflow.key");
const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? readFileSync(keyFile, "utf8");
const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? (existsSync(`${keyFile}.password`) ? readFileSync(`${keyFile}.password`, "utf8") : "");

// asset suffix → the updater targets it serves (`{os}-{arch}-{bundle}` first, then `{os}-{arch}` for unknown bundles)
const TARGETS = [
  ["-setup.exe", ["windows-x86_64-nsis", "windows-x86_64"]],
  [".msi", ["windows-x86_64-msi"]],
  [".AppImage", ["linux-x86_64-appimage", "linux-x86_64"]],
  [".deb", ["linux-x86_64-deb"]],
  [".rpm", ["linux-x86_64-rpm"]],
  // one universal app for both Mac architectures
  [".app.tar.gz", ["darwin-aarch64-app", "darwin-x86_64-app", "darwin-aarch64", "darwin-x86_64"]],
];
const gh = (...args) => execFileSync("gh", [...args, "-R", REPO], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const dir = mkdtempSync(join(tmpdir(), "tcuflow-release-"));
await (async () => {
try {
  // The Mac updater installs from a tarball of the .app, not the dmg: pack the universal build if it is here.
  const macApp = "src-tauri/target/universal-apple-darwin/release/bundle/macos/TCuFlow.app";
  if (existsSync(macApp)) {
    const tgz = join(dir, `TCuFlow_${tag.slice(1)}_universal.app.tar.gz`);
    execFileSync("tar", ["czf", tgz, "-C", join(macApp, ".."), "TCuFlow.app"], { stdio: "inherit" });
    gh("release", "upload", tag, tgz, "--clobber");
    console.log(`uploaded ${tgz}`);
  }
  // CI attaches the installers to the release (build.yml); if its run is still going, wait for it
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let waited = 0; ; waited += 30) {
    const runs = JSON.parse(gh("run", "list", "--workflow", "build.yml", "--event", "release", "--limit", "3", "--json", "status,conclusion,headBranch"));
    const run = runs.find((r) => r.headBranch === tag);
    if (!run || run.status === "completed") {
      if (run?.conclusion && run.conclusion !== "success") console.warn(`build.yml for ${tag}: ${run.conclusion}; signing what is there`);
      break;
    }
    if (waited >= 45 * 60) throw new Error(`build.yml for ${tag} still running after 45 min`);
    if (waited === 0) console.log(`waiting for build.yml to attach the installers to ${tag}…`);
    await sleep(30_000);
  }
  const release = JSON.parse(gh("release", "view", tag, "--json", "body,publishedAt"));
  gh("release", "download", tag, "-D", dir, ...TARGETS.flatMap(([suffix]) => ["-p", `*${suffix}`]));

  const platforms = {};
  for (const name of readdirSync(dir)) {
    const targets = TARGETS.find(([suffix]) => name.endsWith(suffix))?.[1];
    if (!targets) continue;
    // the key goes by environment, never on a command line other processes can read
    const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password };
    execFileSync("npx", ["tauri", "signer", "sign", join(dir, name)], { env, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
    const signature = readFileSync(join(dir, `${name}.sig`), "utf8").trim();
    const url = `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(name)}`;
    for (const t of targets) platforms[t] ??= { url, signature };
    console.log(`signed ${name} → ${targets.join(", ")}`);
  }
  if (!Object.keys(platforms).length) throw new Error(`no installers on ${tag}`);

  const latest = { version: tag.slice(1), notes: release.body ?? "", pub_date: release.publishedAt, platforms };
  writeFileSync(join(dir, "latest.json"), JSON.stringify(latest, null, 2));
  gh("release", "upload", tag, join(dir, "latest.json"), "--clobber");
  console.log(`latest.json uploaded: ${Object.keys(platforms).length} targets`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
})();
