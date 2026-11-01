# Build and staged npm releases

Use Node 22 or 24, the exact npm version from `packageManager`, and .NET 10.

```text
dotnet run --project build -- --target Verify
dotnet run --project build -- --target SetVersion --release-version 0.1.0
RELEASE_REVISION=$(git rev-parse HEAD) dotnet run --project build -- --target DryRun --release-version 0.1.0 --dry-run
```

Verify installs locked dependencies, runs offline CLI, inventory and release-driver tests, and checks the installed tarball. Pack writes
`output/release/` with a tarball and manifest (name, version, source commit, shasum and integrity).
Pack also installs that exact archive into an isolated prefix and checks its executable and RPC.
Every release target requires `RELEASE_REVISION` to equal the full checkout SHA. Live modes require
a clean checkout; Stage also requires the current remote main tip.
`CheckRelease` lists mismatched version sites before verification or packing starts.
TypeScript emits LF; tracked package text uses LF through `.gitattributes`.

| TeamCity object | ID |
|---|---|
| Project | `EyeAuras_OpenSearchCli` |
| VCS root, main only | `EyeAuras_OpenSearchCli_Repo` |
| Verify | `EyeAuras_OpenSearchCli_Verify` |
| Main trigger | `TRIGGER_1` |
| Manual npm staging | `EyeAuras_OpenSearchCli_NpmStage` |

The Linux jobs run `bash build/teamcity.sh` in `node:24-bookworm`. Bootstrap installs .NET 10 in
temporary storage and the pinned npm without publishing tokens. Verify and dry runs have no token
variables. Stage passes `NPM_TOKEN` only to npm stage commands. Registry verification passes the
GitHub credential only to Release API requests, via a temporary header file. Both temporary auth
files live outside the checkout and are removed on exit. No PowerShell or GitHub Actions is used.

## Release flow

1. Run SetVersion, review the version change in a PR and merge it. Select that exact 40-character
   main commit as `<sha>` below. The first release is `0.1.0`.
2. Run the manual staging job with `--dry-run`. Cake packs, installs and tests the exact archive,
   then runs `npm publish --dry-run`. Its receipt must say `dry-run-verified`.
3. Run the same job once with `--stage` and the same SHA. Cake runs `npm stage publish`, saves the
   stage ID immediately, downloads that stage and compares its SHA-512 integrity. The receipt must
   say `awaiting-2fa-approval`. No target approves a stage or runs a live `npm publish`.
4. Download `npm-release.zip` and retain its tarball, `release-manifest.json` and `release.json`.
   The owner approves this stage in npm **Staged Packages**, with 2FA. A newly registered name may
   show npm's `0.0.0-stage` placeholder before approval; this is not the release version.
5. After approval, run `--verify-registry` with the same SHA. Cake repacks from that revision,
   requires the published version and `latest` tag to match the manifest, compares registry integrity,
   and runs the isolated registry installation test. Only then does it create GitHub Release
   `v<version>` at that commit with the archive and manifest. The receipt says `published-verified`.

```sh
teamcity-cli jobs run EyeAuras_OpenSearchCli_NpmStage --param env.RELEASE_MODE=--dry-run --param env.RELEASE_REVISION=<sha> --param release.build=<version>-dry-run
teamcity-cli jobs run EyeAuras_OpenSearchCli_NpmStage --param env.RELEASE_MODE=--stage --param env.RELEASE_REVISION=<sha> --param release.build=<version>-stage
# Owner approves the verified stage on npm before this command:
teamcity-cli jobs run EyeAuras_OpenSearchCli_NpmStage --param env.RELEASE_MODE=--verify-registry --param env.RELEASE_REVISION=<sha> --param release.build=<version>-verify
```

Omit `--branch`: the VCS root uses main. Before verification after later main changes, select the
same source revision in TeamCity's custom build revision settings. `RELEASE_REVISION` is a check,
not a checkout selector. The job is manual and uses the exclusive `opensearch-cli-release` lock.
Its default is `--dry-run`. The copied job's build number pattern requires the one-off `release.build`
input; it labels the build and does not select the package version or checkout revision.
Receipt and archive artifacts are published as `npm-release.zip` even
when later verification fails.

## Failure and recovery

An existing stage for the same version stops staging. Inspect the saved stage ID instead of
re-staging. `staged-unverified` means the remote stage exists but its metadata or archive has not
passed verification; do not approve it. If the command loses its response, inspect
`npm stage list @eyeauras/opensearch-cli --json` before any retry. Do not change a staged version's
bytes or approve a different stage ID. On E403/E404, ask the owner to inspect access; do not widen
the token or disable 2FA.

The protected `npm.token` backs `env.NPM_TOKEN`; it is used only in `--stage`. The existing token
may support direct publishing, so the code and its offline guard tests enforce the staging boundary.
`env.GITHUB_TOKEN` is needed only for the final GitHub Release. Never pass a token as a build-run
parameter, command argument, or literal npmrc entry.

The driver can resume an interrupted GitHub Release asset upload. An existing tag must point at
the packed commit. Inspect receipts and any existing release before retrying; no task rejects a
stage, deletes a release, changes token rights, or performs owner approval.

See npm's [staged publishing](https://docs.npmjs.com/staged-publishing/) documentation.
