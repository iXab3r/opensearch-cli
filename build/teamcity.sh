#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mode="${RELEASE_MODE:---verify-only}"
case "$mode" in
    --verify-only|--dry-run|--stage|--verify-registry) ;;
    *) printf '%s\n' 'Use --verify-only, --dry-run, --stage or --verify-registry.' >&2; exit 2 ;;
esac
# Keep the selected credential out of bootstrap and all verification children.
stage_token="${NPM_TOKEN-}"
github_token="${GITHUB_TOKEN-}"
for key in $(compgen -e); do
    case "${key^^}" in *TOKEN*|NPM_CONFIG_*) unset "$key" ;; esac
done
export CI=true DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$PWD"
tools_dir="$(mktemp -d)"
cleanup() {
    if [[ "$mode" != --verify-only && -d output/release ]]; then
        printf "##teamcity[publishArtifacts 'output/release/* => npm-release.zip']\n"
    fi
    rm -rf -- "$tools_dir"
}
trap cleanup EXIT
if [[ "$mode" != --verify-only ]]; then
    # No receipt from an earlier agent checkout may stand in for this run.
    rm -rf -- output/release
fi
export NPM_CONFIG_USERCONFIG="$tools_dir/npmrc" NPM_CONFIG_GLOBALCONFIG="$tools_dir/global-npmrc"
: > "$NPM_CONFIG_USERCONFIG"
: > "$NPM_CONFIG_GLOBALCONFIG"
curl --fail --silent --show-error --location https://dot.net/v1/dotnet-install.sh -o "$tools_dir/dotnet-install.sh"
bash "$tools_dir/dotnet-install.sh" --channel 10.0 --install-dir "$tools_dir/dotnet" --no-path
export PATH="$tools_dir/dotnet:$PATH"
npm install --global "$(node -p "require('./package.json').packageManager")"
version="$(node -p "require('./package.json').version")"
case "$mode" in
    --verify-only) dotnet run --project build -- --target Verify ;;
    --dry-run) dotnet run --project build -- --target DryRun --release-version "$version" --dry-run ;;
    --stage) NPM_TOKEN="$stage_token" dotnet run --project build -- --target Stage --release-version "$version" ;;
    --verify-registry) GITHUB_TOKEN="$github_token" dotnet run --project build -- --target VerifyRegistry --release-version "$version" ;;
esac
