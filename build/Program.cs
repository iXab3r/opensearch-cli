using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Cake.Core;
using Cake.Frosting;

return new CakeHost().UseContext<BuildContext>().Run(args);

/// <summary>Repository-local process and version context for the single public package.</summary>
public sealed class BuildContext(ICakeContext context) : FrostingContext(context)
{
    public string Root { get; } = FindRoot();
    public string ReleaseDirectory => Path.Combine(Root, "output", "release");
    public bool DryRun => Arguments.HasArgument("dry-run");
    public string RequireVersion()
    {
        var version = Arguments.HasArgument("release-version") ? Arguments.GetArgument("release-version") : "";
        return Regex.IsMatch(version, @"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$") ? version
            : throw new CakeException("Pass --release-version <major.minor.patch>.");
    }

    public Task<string> Run(string tool, params string[] arguments) => RunAt(Root, tool, arguments);

    public async Task<string> RunAt(string directory, string tool, string[] arguments, IReadOnlyDictionary<string, string>? credentials = null)
    {
        var executable = !OperatingSystem.IsWindows() ? tool : (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator).Where(path => path.Trim().Length > 0)
            .SelectMany(path => new[] { ".cmd", ".exe" }.Select(ext => Path.Combine(path.Trim(), tool + ext)))
            .FirstOrDefault(File.Exists) ?? tool;
        var start = new ProcessStartInfo(executable) { WorkingDirectory = directory, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var key in start.Environment.Keys.Where(key => key.Contains("TOKEN", StringComparison.OrdinalIgnoreCase) || key.StartsWith("NPM_CONFIG_", StringComparison.OrdinalIgnoreCase)).ToArray())
            start.Environment.Remove(key);
        if (credentials is not null)
            foreach (var pair in credentials) start.Environment[pair.Key] = pair.Value;
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        Console.WriteLine($"> {tool} {string.Join(' ', arguments)}");
        using var process = Process.Start(start) ?? throw new CakeException($"Could not start {tool}.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        var output = await stdout;
        var diagnostic = await stderr;
        await process.WaitForExitAsync();
        if (process.ExitCode != 0)
        {
            // npm may include credentials or registry responses in its diagnostics.
            var code = Regex.Match(diagnostic + output, @"\bE(?:403|404)\b").Value;
            throw new CakeException($"{tool} exited with code {process.ExitCode}{(code.Length > 0 ? $" ({code}); ask the owner before retrying" : "")}.");
        }
        return output.Trim();
    }

    public void CheckVersions()
    {
        var version = RequireVersion();
        var problems = new List<string>();
        foreach (var file in new[] { "package.json", "package-lock.json" })
        {
            using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(Root, file)));
            if (json.RootElement.GetProperty("version").GetString() != version) problems.Add(file);
            if (file == "package-lock.json" && json.RootElement.GetProperty("packages").GetProperty("").GetProperty("version").GetString() != version)
                problems.Add("package-lock.json packages[\"\"]");
        }
        if (File.ReadAllText(Path.Combine(Root, "src", "version.ts")).Trim() != $"export const version = \"{version}\";") problems.Add("src/version.ts");
        if (problems.Count > 0) throw new CakeException("Version mismatch: " + string.Join(", ", problems));
    }

    private static string FindRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "build", "Build.csproj"))) return directory.FullName;
        throw new CakeException("Run from an opensearch-cli checkout.");
    }
}
