import { CliError, diagnosticCause, tokenAuth, type AuthContext, type AuthDefinition } from "@eyeauras/cli-factory";
import { clientFor, OpenSearchClient } from "./client.js";

// Passwords are arbitrary secrets: preserve whitespace, removing only one terminal line ending.
async function readPassword(context: AuthContext): Promise<string> {
  const chunks: Buffer[] = [];
  const abort = () => context.io.input.destroy(new CliError("Password input interrupted.", { code: "interrupted", exitCode: 130 }));
  context.signal.throwIfAborted();
  context.signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of context.io.input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    context.signal.throwIfAborted();
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  } finally { context.signal.removeEventListener("abort", abort); }
}

export function openSearchAuth(): AuthDefinition {
  const bearer = tokenAuth({
    validate: context => new OpenSearchClient({ url: String(context.profile.values.url), fetch: context.fetch, signal: context.signal, authorization: "Bearer " + context.token }).identity(),
  });
  return {
    // Every scheme validates the connection at configure/login/status, including open clusters.
    required: () => true,
    isReady: async context => context.profile.values.auth === "none" || !!await context.secrets.get(context.profile.values.auth === "bearer" ? "token" : "basic"),
    loginOptions: [
      { flags: "--username <name>", description: "Set the Basic authentication username" },
      { flags: "--password-stdin", description: "Read the Basic password from stdin" },
      ...(bearer.loginOptions ?? []),
    ],
    async login(context, options) {
      if (context.profile.values.auth === "none") {
        await new OpenSearchClient({ url: String(context.profile.values.url), fetch: context.fetch, signal: context.signal }).info();
        await context.secrets.delete("basic");
        await context.secrets.delete("token");
        return { authenticated: true, identity: { url: context.profile.values.url, reachable: true } };
      }
      if (context.profile.values.auth === "bearer") {
        try {
          const status = await bearer.login(context, options);
          await context.secrets.delete("basic");
          return status;
        } catch (error) {
          const code = error instanceof CliError && error.code === "auth.validationFailed"
            ? (error.cause as { code?: string })?.code : undefined;
          if (code?.startsWith("http.")) throw new CliError("OpenSearch rejected the authentication check.", {
            code, cause: error, next: [["profile", "configure", context.profile.name, "--url", String(context.profile.values.url), "--auth", "bearer", "--token-stdin"]],
          });
          throw error;
        }
      }
      if (!options.passwordStdin || !context.stdinAvailable || typeof options.username !== "string" || !options.username || options.username.includes(":"))
        throw new CliError("Provide --username and --password-stdin for Basic authentication.", { code: "auth.missing", next: [["auth", "login", "--help"]] });
      const password = await readPassword(context);
      if (!password) throw new CliError("The Basic password is empty.", { code: "auth.missing", next: [["auth", "login", "--help"]] });
      const authorization = "Basic " + Buffer.from(`${options.username}:${password}`).toString("base64");
      const client = new OpenSearchClient({ url: String(context.profile.values.url), fetch: context.fetch, signal: context.signal, authorization });
      const identity = await client.identity();
      context.signal.throwIfAborted();
      try { await context.secrets.set("basic", JSON.stringify({ username: options.username, password })); }
      catch (cause) {
        throw new CliError("Could not save Basic credentials in secure storage.", { code: "auth.storeFailed", cause: diagnosticCause(cause, [password, authorization]), next: [["auth", "login", "--help"]] });
      }
      await context.secrets.delete("token");
      return { authenticated: true, identity };
    },
    async status(context) {
      if (context.profile.values.auth === "none") return { authenticated: true, identity: await (await clientFor(context)).identity() };
      const name = context.profile.values.auth === "bearer" ? "token" : "basic";
      if (!await context.secrets.get(name)) return { authenticated: false };
      return { authenticated: true, identity: await (await clientFor(context)).identity() };
    },
    async logout(context) {
      await context.secrets.delete("basic");
      await bearer.logout(context);
    },
  };
}
