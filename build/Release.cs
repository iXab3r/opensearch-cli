using System.Security.Cryptography;
using System.Text.Json;
using Cake.Core;
using Cake.Frosting;

/// <summary>Evidence binding one tested archive to its source revision and npm stage.</summary>
public sealed record ReleaseManifest(string name, string version, string commit, string file, string shasum, string integrity);

/// <summary>Runs staged publication only; approval remains an owner action on npm.</summary>
public sealed class ReleaseFlow(BuildContext context) : IDisposable
{
    private const string Registry = "https://registry.npmjs.org/";
    private readonly string temporary = Path.Combine(Path.GetTempPath(), "opensearch-release-" + Guid.NewGuid());
    private readonly JsonSerializerOptions json = new() { WriteIndented = true };
    private ReleaseManifest manifest = null!;
    private string Archive => Path.Combine(context.ReleaseDirectory, manifest.file);

    public async Task Execute(string mode)
    {
        if (context.DryRun && mode != "dry-run") throw new CakeException("Use target DryRun with --dry-run.");
        await new CheckReleaseTask().RunAsync(context);
        manifest = JsonSerializer.Deserialize<ReleaseManifest>(File.ReadAllText(Path.Combine(context.ReleaseDirectory, "release-manifest.json")))!;
        if (manifest.name != "@eyeauras/opensearch-cli" || manifest.version != context.RequireVersion() || manifest.commit != Environment.GetEnvironmentVariable("RELEASE_REVISION")
            || Path.GetFileName(manifest.file) != manifest.file || Integrity(Archive) != manifest.integrity)
            throw new CakeException("Release archive does not match the source manifest.");
        if (OperatingSystem.IsWindows()) Directory.CreateDirectory(temporary);
        else Directory.CreateDirectory(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        File.WriteAllText(Path.Combine(temporary, "npmrc"), "");
        File.WriteAllText(Path.Combine(temporary, "global-npmrc"), "");
        if (mode == "dry-run")
        {
            await Npm(context.Root, ["publish", Archive, "--dry-run", "--access", "public", "--tag", "latest"]);
            Receipt("dry-run-verified");
        }
        else if (mode == "stage") await Stage();
        else if (mode == "verify-registry") await VerifyRegistry();
        else throw new CakeException("Unknown release mode.");
    }

    private async Task Stage()
    {
        var remote = await context.Run("git", "ls-remote", "origin", "refs/heads/main");
        if (remote.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() != manifest.commit)
            throw new CakeException("Staging requires the current remote main tip.");
        var token = Environment.GetEnvironmentVariable("NPM_TOKEN");
        if (string.IsNullOrWhiteSpace(token)) throw new CakeException("Staging requires NPM_TOKEN.");
        File.WriteAllText(Path.Combine(temporary, "npmrc"), "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(Path.Combine(temporary, "npmrc"), UnixFileMode.UserRead | UnixFileMode.UserWrite);
        using var stages = JsonDocument.Parse(await Npm(context.Root, ["stage", "list", manifest.name, "--json"], token));
        if (stages.RootElement.EnumerateArray().Any(item => item.GetProperty("version").GetString() == manifest.version))
            throw new CakeException("This version already has a stage; inspect its receipt before retrying.");
        using var staged = JsonDocument.Parse(await Npm(context.Root, ["stage", "publish", Archive, "--json", "--access", "public", "--tag", "latest"], token));
        var package = staged.RootElement.GetProperty(manifest.name);
        var id = package.GetProperty("stageId").GetString()!;
        // Keep the remote identity before checking metadata or downloading bytes.
        Receipt("staged-unverified", id);
        if (!Guid.TryParse(id, out _) || package.GetProperty("name").GetString() != manifest.name
            || package.GetProperty("version").GetString() != manifest.version || package.GetProperty("integrity").GetString() != manifest.integrity)
            throw new CakeException("Stage metadata differs from the tested archive; inspect the saved stage ID.");
        var download = Path.Combine(temporary, "download");
        Directory.CreateDirectory(download);
        await Npm(download, ["stage", "download", id], token);
        var archives = Directory.GetFiles(download, "*.tgz");
        if (archives.Length != 1 || Integrity(archives[0]) != manifest.integrity)
            throw new CakeException("Downloaded stage differs from the tested archive; inspect the saved stage ID.");
        Receipt("awaiting-2fa-approval", id);
        Console.WriteLine($"Stage {id} verified: {manifest.name}@{manifest.version}. Owner approval is required on npm.");
    }

    private async Task VerifyRegistry()
    {
        using var version = JsonDocument.Parse(await Npm(context.Root, ["view", $"{manifest.name}@{manifest.version}", "version", "dist.integrity", "--json"]));
        using var latest = JsonDocument.Parse(await Npm(context.Root, ["view", manifest.name, "dist-tags.latest", "--json"]));
        if (manifest.version == "0.0.0-stage" || version.RootElement.GetProperty("version").GetString() != manifest.version
            || version.RootElement.GetProperty("dist.integrity").GetString() != manifest.integrity || latest.RootElement.GetString() != manifest.version)
            throw new CakeException("Registry version, latest tag or integrity differs from the manifest.");
        await Npm(context.Root, ["run", "test:registry", "--", manifest.version]);
        var token = Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        if (string.IsNullOrWhiteSpace(token)) throw new CakeException("GitHub Release creation requires GITHUB_TOKEN.");
        // Use the GitHub API through curl: the CI Node image does not include gh.
        var headers = Path.Combine(temporary, "github-headers");
        File.WriteAllText(headers, $"Authorization: Bearer {token}\nAccept: application/vnd.github+json\nX-GitHub-Api-Version: 2022-11-28\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(headers, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        await CreateGitHubRelease(headers);
        Receipt("published-verified");
    }

    private async Task CreateGitHubRelease(string headers)
    {
        const string repository = "https://api.github.com/repos/iXab3r/opensearch-cli";
        var tag = "v" + manifest.version;
        var tagRef = await context.Run("git", "ls-remote", "origin", "refs/tags/" + tag, "refs/tags/" + tag + "^{}");
        if (tagRef.Length > 0 && !tagRef.Split('\n').Last().StartsWith(manifest.commit + "\t", StringComparison.Ordinal))
            throw new CakeException("The release tag points to a different commit.");
        var response = Path.Combine(temporary, "github-response.json");
        async Task<string> Curl(params string[] arguments) => await context.Run("curl", ["--disable", "--silent", "--show-error", "--header", "@" + headers, "--output", response, "--write-out", "%{http_code}", .. arguments]);
        var status = await Curl(repository + "/releases/tags/" + tag);
        if (status == "404")
        {
            var body = Path.Combine(temporary, "github-release.json");
            File.WriteAllText(body, JsonSerializer.Serialize(new { tag_name = tag, target_commitish = manifest.commit, name = tag, body = $"{manifest.name}@{manifest.version}\nIntegrity: {manifest.integrity}" }));
            status = await Curl("--request", "POST", "--header", "Content-Type: application/json", "--data-binary", "@" + body, repository + "/releases");
            if (status != "201") throw new CakeException("GitHub Release creation failed; inspect the release before retrying.");
        }
        else if (status != "200") throw new CakeException("GitHub Release lookup failed.");
        else if (tagRef.Length == 0) throw new CakeException("The existing GitHub Release has no matching source tag.");
        using var release = JsonDocument.Parse(File.ReadAllText(response));
        var id = release.RootElement.GetProperty("id").GetInt64();
        var assets = release.RootElement.GetProperty("assets").EnumerateArray().ToDictionary(asset => asset.GetProperty("name").GetString()!);
        foreach (var file in new[] { Archive, Path.Combine(context.ReleaseDirectory, "release-manifest.json") })
        {
            if (assets.TryGetValue(Path.GetFileName(file), out var existing))
            {
                var downloaded = Path.Combine(temporary, "existing-asset");
                await context.Run("curl", "--disable", "--fail", "--silent", "--show-error", "--location", "--output", downloaded, existing.GetProperty("browser_download_url").GetString()!);
                if (Integrity(downloaded) != Integrity(file)) throw new CakeException("Existing GitHub Release asset differs from the verified archive.");
                continue;
            }
            status = await Curl("--request", "POST", "--header", "Content-Type: application/octet-stream", "--data-binary", "@" + file,
                $"https://uploads.github.com/repos/iXab3r/opensearch-cli/releases/{id}/assets?name={Uri.EscapeDataString(Path.GetFileName(file))}");
            if (status != "201") throw new CakeException("GitHub Release asset upload failed; inspect the release before retrying.");
        }
    }

    private Task<string> Npm(string directory, string[] arguments, string? token = null)
    {
        var environment = new Dictionary<string, string> {
            ["NPM_CONFIG_USERCONFIG"] = Path.Combine(temporary, "npmrc"), ["NPM_CONFIG_GLOBALCONFIG"] = Path.Combine(temporary, "global-npmrc"),
        };
        if (token is not null) environment["NPM_TOKEN"] = token;
        return context.RunAt(directory, "npm", ["--registry", Registry, .. arguments], environment);
    }

    private void Receipt(string status, string? stageId = null) => File.WriteAllText(Path.Combine(context.ReleaseDirectory, "release.json"),
        JsonSerializer.Serialize(new { status, stageId, revision = manifest.commit, manifest.name, manifest.version, manifest.integrity }, json) + "\n");
    private static string Integrity(string path) => "sha512-" + Convert.ToBase64String(SHA512.HashData(File.ReadAllBytes(path)));
    public void Dispose() { if (Directory.Exists(temporary)) Directory.Delete(temporary, true); }
}

[TaskName("DryRun")]
[IsDependentOn(typeof(PackTask))]
public sealed class DryRunTask : AsyncFrostingTask<BuildContext>
{
    public override async Task RunAsync(BuildContext context) { using var flow = new ReleaseFlow(context); await flow.Execute("dry-run"); }
}

[TaskName("Stage")]
[IsDependentOn(typeof(PackTask))]
public sealed class StageTask : AsyncFrostingTask<BuildContext>
{
    public override async Task RunAsync(BuildContext context) { using var flow = new ReleaseFlow(context); await flow.Execute("stage"); }
}

[TaskName("VerifyRegistry")]
[IsDependentOn(typeof(PackTask))]
public sealed class VerifyRegistryTask : AsyncFrostingTask<BuildContext>
{
    public override async Task RunAsync(BuildContext context) { using var flow = new ReleaseFlow(context); await flow.Execute("verify-registry"); }
}
