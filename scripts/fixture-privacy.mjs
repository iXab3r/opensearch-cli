import { isIP } from "node:net";
import { readdir, readFile } from "node:fs/promises";

// Defense in depth for synthetic fixtures; human review remains mandatory.
export function fixtureFindings(text) {
  const findings = new Set();
  // Relative Markdown documentation links are paths, not network addresses.
  text = text.replace(/\]\((?!https?:\/\/)[^)]*\)/gi, "]()");
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>\])]+/gi)) {
    try {
      const host = new URL(match[0]).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (host !== "localhost" && !isIP(host) && !/(^|\.)example\.(com|org)$/.test(host)) findings.add("non-example hostname");
    } catch { findings.add("invalid URL"); }
  }
  if (/\b(?:authorization|proxy-authorization|set-cookie)\s*["']?\s*:/i.test(text)) findings.add("credential header");
  if (/-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.test(text)) findings.add("token or private key");
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    if (isIP(match[0]) && !/^(?:127\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(match[0])) findings.add("non-reserved IPv4");
  }
  for (const match of text.matchAll(/(?:https?:\/\/|\b)([a-zA-Z0-9][\w-]*(?:\.[a-zA-Z0-9][\w-]*)+)(?::\d+)?/g)) {
    const host = match[1].toLowerCase();
    if (!isIP(host) && /\.[a-z]{2,}$/.test(host) && !/(^|\.)example\.(com|org)$/.test(host)) findings.add("non-example hostname");
  }
  for (const match of text.matchAll(/\[([\da-f:]+)\]|["\s]([\da-f]*:[\da-f:]+)["\s]/gi)) {
    const address = match[1] ?? match[2];
    if (isIP(address) === 6 && address !== "::1" && !/^2001:db8:/i.test(address)) findings.add("non-reserved IPv6");
  }
  return [...findings];
}

export async function scanFixtureTree(root) {
  const findings = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = entry.parentPath + "/" + entry.name;
    for (const reason of fixtureFindings(await readFile(path, "utf8"))) findings.push({ path, reason });
  }
  return findings;
}
