# Windows code signing through SignPath Foundation

SignPath Foundation signs open-source Windows software for free: the certificate is theirs ("SignPath Foundation"
as publisher), the signing runs on SignPath, and each request comes from this repository's GitHub Actions, approved
by hand. Signed installers lose "Unknown publisher"; SmartScreen may still warn until downloads build reputation.

**Status (November 2026): declined.** The Foundation wants visible public adoption first (stars, forks,
contributors, articles or discussions elsewhere) and invites a new application once the project has it. Until then
Windows installers ship unsigned, with GPG-signed `SHA256SUMS`. Paths in the meantime: a paid SignPath subscription,
or an individual open-source certificate (e.g. Certum) used through `bundle.windows.signCommand`.

## 1. Apply (once)

At https://signpath.org → Apply. What they check, and where TCuFlow answers it:

- OSI license: Apache-2.0 (`LICENSE`, LOKA credit in `NOTICE`).
- Public source and releases: https://github.com/tcuber11/tcu-flow, releases since v0.9.5.
- Built by CI only: `.github/workflows/build.yml`.
- Code signing policy on the project site: https://tcuber11.github.io/tcu-flow/code-signing.html
  (the "Free code signing provided by SignPath.io, certificate by SignPath Foundation" line, team roles, privacy).
- MFA on the GitHub account (and later on SignPath).

## 2. After acceptance

SignPath sets up an organization and a project. In it: connect GitHub as trusted build system, an artifact
configuration for an NSIS installer and the exe inside, and a `release-signing` policy with manual approval.
Then put into the repository:

- secret `SIGNPATH_API_TOKEN` (a CI user's token);
- variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`.

The windows jobs then build the exe without bundling, have SignPath sign it, bundle the installer around the signed
exe, and have SignPath sign the installer (`signpath/github-action-submit-signing-request`), before attaching it to
the release. That workflow change is made once the IDs above exist, so it can be tested on a manual run.
