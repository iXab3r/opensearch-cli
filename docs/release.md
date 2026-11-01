# Build and release preparation

Use Node 22 or 24, the exact npm version from `packageManager`, and .NET 10.

```text
dotnet run --project build -- --target Verify
dotnet run --project build -- --target SetVersion --release-version 0.1.0
dotnet run --project build -- --target Pack --release-version 0.1.0 --dry-run
```

Verify installs locked dependencies, runs offline tests and checks the installed tarball. Pack writes
`output/release/` with a tarball and manifest (name, version, source commit, shasum and integrity).
Without `--dry-run`, release preparation requires a clean checkout at the current origin/main tip.
`CheckRelease` lists mismatched version sites before verification or packing starts.
TypeScript emits LF; tracked package text uses LF through `.gitattributes`.

| TeamCity object | ID |
|---|---|
| Project | `EyeAuras_OpenSearchCli` |
| VCS root, main only | `EyeAuras_OpenSearchCli_Repo` |
| Verify | `EyeAuras_OpenSearchCli_Verify` |
| Main trigger | `TRIGGER_4` |
| Manual npm staging | `EyeAuras_OpenSearchCli_NpmStage` |

The Linux Verify job runs `bash build/teamcity.sh` in `node:24-bookworm`. The entry point clears npm
and GitHub publishing tokens before bootstrap, installs .NET 10 in temporary storage and the pinned
npm, then runs Cake Verify. No PowerShell or GitHub Actions is used.

Staging and registry release modes remain issue #4; this driver cannot publish or stage a release.
After infrastructure merges, run Verify on main, then enable `TRIGGER_4` only after a green build.
