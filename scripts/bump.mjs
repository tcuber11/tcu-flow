// node scripts/bump.mjs 0.9.7
// Writes the version everywhere it is spelled out: package.json, Cargo.toml, tauri.conf.json, the iOS project,
// and the site's download links and lead. Then: commit and push (the tag must land on that commit), `gh release
// create vX.Y.Z --generate-notes` (CI attaches every installer), `node scripts/release.mjs vX.Y.Z` to sign latest.json.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  console.error("usage: node scripts/bump.mjs 0.9.7");
  process.exit(1);
}
const current = JSON.parse(readFileSync("package.json", "utf8")).version;
if (current === next) {
  console.error(`already ${next}`);
  process.exit(1);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const edits = [
  ["package.json", [[`"version": "${current}"`, `"version": "${next}"`]]],
  ["src-tauri/Cargo.toml", [[`version = "${current}"`, `version = "${next}"`]]],
  ["src-tauri/tauri.conf.json", [[`"version": "${current}"`, `"version": "${next}"`]]],
  ["src-tauri/gen/apple/tcuflow_iOS/Info.plist", [[`<string>${current}</string>`, `<string>${next}</string>`]]],
  ["src-tauri/gen/apple/project.yml", [[`CFBundleShortVersionString: ${current}`, `CFBundleShortVersionString: ${next}`], [`CFBundleVersion: "${current}"`, `CFBundleVersion: "${next}"`]]],
  ["site/index.html", [[`TCuFlow_${current}_`, `TCuFlow_${next}_`], [`Versi awal ${current}.`, `Versi awal ${next}.`], [`Early version ${current}.`, `Early version ${next}.`]]],
];
for (const [file, pairs] of edits) {
  let text = readFileSync(file, "utf8");
  for (const [from, to] of pairs) {
    const n = (text.match(new RegExp(esc(from), "g")) ?? []).length;
    if (!n) throw new Error(`${file}: "${from}" not found`);
    text = text.replaceAll(from, to);
    console.log(`${file}: ${n} × ${from} → ${to}`);
  }
  writeFileSync(file, text);
}
// Cargo.lock carries the crate's own version too
execFileSync("cargo", ["update", "--manifest-path", "src-tauri/Cargo.toml", "--workspace", "--offline"], { stdio: "inherit" });
console.log(`\n${current} → ${next}. Next: commit and push, gh release create v${next} --generate-notes, then node scripts/release.mjs v${next}`);
