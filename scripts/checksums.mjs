// node scripts/checksums.mjs v0.9.11
// SHA256SUMS for every file on the release (from the checksums GitHub keeps for each), signed with the
// "TCuFlow releases" GPG key (scripts/release-key.sh), both uploaded to the release. release.mjs runs this last.
// Anyone can check a download: see README → Verify a download.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "tcuber11/tcu-flow";
const KEY = "TCuFlow releases";

export function signChecksums(tag) {
  const gh = (...args) => execFileSync("gh", [...args, "-R", REPO], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const pass = join(homedir(), ".tauri", "tcuflow-gpg.password");
  if (!existsSync(pass)) {
    console.warn("no release GPG key (scripts/release-key.sh): SHA256SUMS not signed");
    return;
  }
  const { assets } = JSON.parse(execFileSync("gh", ["api", `repos/${REPO}/releases/tags/${tag}`], { encoding: "utf8" }));
  const files = assets.filter((a) => !a.name.startsWith("SHA256SUMS"));
  const missing = files.filter((a) => !a.digest?.startsWith("sha256:"));
  if (missing.length) throw new Error(`GitHub has no checksum for ${missing.map((a) => a.name).join(", ")} yet`);
  // the format sha256sum -c and shasum -a 256 -c read
  const sums = files.map((a) => `${a.digest.slice(7)}  ${a.name}`).sort((x, y) => x.slice(66).localeCompare(y.slice(66))).join("\n") + "\n";
  const dir = mkdtempSync(join(tmpdir(), "tcuflow-sums-"));
  try {
    const file = join(dir, "SHA256SUMS");
    writeFileSync(file, sums);
    execFileSync("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-file", pass, "--local-user", KEY, "--armor", "--detach-sign", "--output", `${file}.asc`, file], { stdio: "inherit" });
    gh("release", "upload", tag, file, `${file}.asc`, "--clobber");
    console.log(`SHA256SUMS signed and uploaded: ${files.length} files`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2];
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
    console.error("usage: node scripts/checksums.mjs v0.9.11");
    process.exit(1);
  }
  signChecksums(tag);
}
