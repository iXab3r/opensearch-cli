#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mode="${RELEASE_MODE:---verify-only}"
if [[ "$mode" != --verify-only ]]; then
    printf '%s\n' 'RELEASE_MODE currently supports --verify-only; staging is tracked in issue #4.' >&2
    exit 2
fi
# Verification and bootstrap never inherit publication credentials.
unset NPM_TOKEN NODE_AUTH_TOKEN GH_TOKEN GITHUB_TOKEN
export CI=true DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$PWD"
tools_dir="$(mktemp -d)"
trap 'rm -rf -- "$tools_dir"' EXIT
curl --fail --silent --show-error --location https://dot.net/v1/dotnet-install.sh -o "$tools_dir/dotnet-install.sh"
bash "$tools_dir/dotnet-install.sh" --channel 10.0 --install-dir "$tools_dir/dotnet" --no-path
export PATH="$tools_dir/dotnet:$PATH"
npm install --global "$(node -p "require('./package.json').packageManager")"
dotnet run --project build -- --target Verify
