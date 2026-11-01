using System.Text.Json;
using System.Text.Json.Nodes;
using Cake.Core;
using Cake.Frosting;

[TaskName("Verify")]
public sealed class VerifyTask : AsyncFrostingTask<BuildContext>
{
    public override async Task RunAsync(BuildContext context)
    {
        await context.Run("npm", "ci", "--no-audit", "--no-fund");
        await context.Run("npm", "--prefix", "tools/api-inventory", "ci", "--no-audit", "--no-fund");
        Console.WriteLine(await context.Run("npm", "test"));
        Console.WriteLine(await context.Run("npm", "--prefix", "tools/api-inventory", "test"));
        Console.WriteLine(await context.Run("npm", "run", "test:package"));
        Console.WriteLine(await context.Run("node", "--test", "scripts/test-release.mjs"));
    }
}

[TaskName("SetVersion")]
public sealed class SetVersionTask : AsyncFrostingTask<BuildContext>
{
    public override async Task RunAsync(BuildContext context)
    {
        var version = context.RequireVersion();
        var path = Path.Combine(context.Root, "package.json");
        var json = JsonNode.Parse(File.ReadAllText(path))!;
        json["version"] = version;
        File.WriteAllText(path, json.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n");
        File.WriteAllText(Path.Combine(context.Root, "src", "version.ts"), $"export const version = \"{version}\";\n");
        await context.Run("npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund");
        context.CheckVersions();
    }
}

[TaskName("CheckRelease")]
public sealed class CheckReleaseTask : AsyncFrostingTask<BuildContext>
{
    public override async Task RunAsync(BuildContext context)
    {
        context.CheckVersions();
        var revision = Environment.GetEnvironmentVariable("RELEASE_REVISION") ?? "";
        if (!System.Text.RegularExpressions.Regex.IsMatch(revision, "^[0-9a-f]{40}$") || revision != await context.Run("git", "rev-parse", "HEAD"))
            throw new CakeException("RELEASE_REVISION must equal the full checkout SHA.");
        if (context.DryRun) return;
        if ((await context.Run("git", "status", "--porcelain")).Length > 0) throw new CakeException("A live release requires a clean working tree.");
    }
}

[TaskName("Pack")]
[IsDependentOn(typeof(CheckReleaseTask))]
[IsDependentOn(typeof(VerifyTask))]
public sealed class PackTask : AsyncFrostingTask<BuildContext>
{
    public override async Task RunAsync(BuildContext context)
    {
        Directory.CreateDirectory(context.ReleaseDirectory);
        using var packed = JsonDocument.Parse(await context.Run("npm", "pack", "--json", "--ignore-scripts", "--pack-destination", context.ReleaseDirectory));
        var package = packed.RootElement[0];
        if (package.GetProperty("version").GetString() != context.RequireVersion()) throw new CakeException("Packed version differs from release version.");
        var manifest = new {
            name = package.GetProperty("name").GetString(), version = context.RequireVersion(),
            commit = await context.Run("git", "rev-parse", "HEAD"),
            file = package.GetProperty("filename").GetString(), shasum = package.GetProperty("shasum").GetString(),
            integrity = package.GetProperty("integrity").GetString(),
        };
        File.WriteAllText(Path.Combine(context.ReleaseDirectory, "release-manifest.json"),
            JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }) + "\n");
        Console.WriteLine(await context.Run("npm", "run", "test:package", "--", "--tarball", Path.Combine(context.ReleaseDirectory, manifest.file!)));
    }
}
