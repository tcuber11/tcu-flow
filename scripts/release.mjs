// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
// node scripts/release.mjs v0.9.0
// Once CI (build.yml) has attached the installers to the GitHub release: downloads them, signs each with the
// updater key, and uploads latest.json, which the in-app updater reads from releases/latest/download/latest.json.
// Key: TAURI_SIGNING_PRIVATE_KEY(_PASSWORD), else ~/.tauri/tcuflow.key(.password).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
  ["_arm64-setup.exe", ["windows-aarch64-nsis", "windows-aarch64"]],
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
  // Only CI's files are signed: its Mac tarball is the notarized one (a local build is ad-hoc, and was once
  // uploaded over it here).
  // CI attaches the installers to the release (build.yml); if its run is still going, wait for it. Right after
  // `gh release create` the run may not be listed yet, so give it two minutes to appear before signing without it.
  // Notarizing alone can take 40 minutes.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let waited = 0; ; waited += 30) {
    const runs = JSON.parse(gh("run", "list", "--workflow", "build.yml", "--event", "release", "--limit", "3", "--json", "databaseId,status,conclusion,headBranch"));
    const run = runs.find((r) => r.headBranch === tag);
    if (run?.status === "completed") {
      if (run.conclusion !== "success") {
        // a desktop installer missing from latest.json leaves that platform without the update (a job GitHub had
        // no runner for ends "cancelled"); the phone jobs aren't in latest.json
        const { jobs } = JSON.parse(gh("run", "view", String(run.databaseId), "--json", "jobs"));
        const missing = jobs.filter((j) => ["macos", "windows", "windows-arm64", "linux"].includes(j.name) && j.conclusion !== "success");
        if (missing.length)
          throw new Error(`build.yml for ${tag}: ${missing.map((j) => `${j.name} ${j.conclusion}`).join(", ")}. Re-run with \`gh run rerun ${run.databaseId} --failed\`, then run this again.`);
        console.warn(`build.yml for ${tag}: ${run.conclusion} (${jobs.filter((j) => j.conclusion !== "success" && j.conclusion !== "skipped").map((j) => j.name).join(", ")}); the installers are all there`);
      }
      break;
    }
    if (!run && waited >= 120) break;
    if (waited >= 90 * 60) throw new Error(`build.yml for ${tag} still running after 90 min`);
    if (waited === 0) console.log(`waiting for build.yml to attach the installers to ${tag}…`);
    await sleep(30_000);
  }
  const release = JSON.parse(gh("release", "view", tag, "--json", "body,publishedAt"));
  gh("release", "download", tag, "-D", dir, ...TARGETS.flatMap(([suffix]) => ["-p", `*${suffix}`]));

  // an installer of another version (a tag on a commit that wasn't bumped) would make every client "update" to it,
  // still be offered this version, and loop
  const version = tag.slice(1);
  const stray = readdirSync(dir).filter((n) => TARGETS.some(([s]) => n.endsWith(s)) && !n.includes(`_${version}_`) && !n.includes(`-${version}-`));
  if (stray.length) throw new Error(`${tag} carries installers of another version: ${stray.join(", ")}. Was the bump commit pushed before the tag?`);

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
  packageManagers(version);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
})();

/** Homebrew (Casks/) and Scoop (bucket/) install from this repository: point both at this release, with the
 *  checksums GitHub keeps for each file, and commit that (no CI run: nothing to build). */
function packageManagers(version) {
  const { assets } = JSON.parse(gh("api", `repos/${REPO}/releases/tags/${tag}`));
  const sha = (suffix) => assets.find((a) => a.name.endsWith(suffix))?.digest?.replace(/^sha256:/, "");
  const sums = { dmg: sha("_universal.dmg"), x64: sha("_x64-setup.exe"), arm64: sha("_arm64-setup.exe") };
  if (!Object.values(sums).every(Boolean)) {
    console.warn(`no checksums for the dmg and setup files of ${tag}: Homebrew and Scoop stay on the previous release`);
    return;
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = ["Casks/tcuflow.rb", "bucket/tcuflow.json"];
  const [cask, scoop] = files.map((f) => join(root, f));
  writeFileSync(cask, readFileSync(cask, "utf8").replace(/version "[^"]*"/, `version "${version}"`).replace(/sha256 "[^"]*"/, `sha256 "${sums.dmg}"`));
  const manifest = JSON.parse(readFileSync(scoop, "utf8"));
  manifest.version = version;
  for (const [arch, name] of [["64bit", "x64"], ["arm64", "arm64"]])
    manifest.architecture[arch] = { url: `https://github.com/${REPO}/releases/download/${tag}/TCuFlow_${version}_${name}-setup.exe#/setup.exe`, hash: sums[name] };
  writeFileSync(scoop, JSON.stringify(manifest, null, 4) + "\n");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (!git("status", "--porcelain", "--", ...files).trim()) return;
  git("commit", "-m", `chore: Homebrew and Scoop install ${tag} [skip ci]`, "--", ...files);
  try {
    git("push");
    console.log(`Homebrew and Scoop now install ${tag}`);
  } catch {
    console.warn("Homebrew and Scoop files are committed but not pushed: run git push");
  }
}
