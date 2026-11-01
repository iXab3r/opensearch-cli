import { CliError, streamResult, type CommandContext, type StreamResult } from "@eyeauras/cli-factory";
import { clientFor, type SearchHit, type SearchResult } from "./client.js";

/** The caller's finite result budget; observed hits include the one-hit overflow lookahead. */
interface PagingCounts { retrievedCount: number; observedCount: number; maxResults: number }

/** Local failure metadata, without the bodies of hits that were not yielded. */
export interface PagingFailure extends PagingCounts {
  partial?: SearchResult["partial"];
  cleanupFailed?: boolean;
}

/** Owns one finite PIT traversal; Core owns consumption, output backpressure and cancellation. */
export function searchAll(
  index: string, body: Record<string, unknown>, maxResults: number, tieBreaker: string | undefined,
  strict: boolean, context: CommandContext,
  checkCompleteness: (page: SearchResult, context: CommandContext, strict: boolean) => SearchResult,
): StreamResult<SearchHit> {
  const pageSize = body.size ?? 1000;
  if (typeof pageSize !== "number" || !Number.isSafeInteger(pageSize) || pageSize < 1)
    throw new CliError("Page size must be a positive integer with --all.", { code: "usage" });
  if (["pit", "from", "search_after", "aggs", "aggregations"].some(key => key in body))
    throw new CliError("Use a one-page search for paging keys or aggregations.", { code: "usage" });
  return streamResult(async function* (signal) {
    const scoped = { ...context, signal };
    const client = await clientFor(scoped);
    const info = await client.info();
    const [major, minor] = info.version.number.split(".").map(Number);
    if (info.version.distribution !== "opensearch" || ![2, 3].includes(major!) || (major === 2 && minor! < 4))
      throw new CliError("Point-in-time paging requires OpenSearch 2.4 or newer.", { code: "search.pitUnavailable" });
    const automatic = major === 3 && minor! >= 3;
    if (!tieBreaker && !automatic)
      throw new CliError("Set --tie-breaker to a unique sortable doc-values field on OpenSearch before 3.3.", { code: "usage" });
    const suppliedSort = body.sort === undefined ? [] : Array.isArray(body.sort) ? body.sort : [body.sort];
    // OpenSearch expands a compound sort object's properties into separate cursor fields.
    const sort = suppliedSort.flatMap(entry => entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.entries(entry).map(([field, order]) => ({ [field]: order })) : [entry]);
    // OpenSearch3.3 encodes a shard-local document key: include the index for multi-index PITs.
    sort.push(...(tieBreaker ? [{ [tieBreaker]: { order: "asc" } }] : [{ _index: "asc" }, { _shard_doc: { order: "asc" } }]));
    const counts: PagingCounts = { retrievedCount: 0, observedCount: 0, maxResults };
    const warnings = new Set<string>();
    let pit: string | undefined;
    let failure: unknown;
    let failed = false;
    try {
      pit = await client.createPit(index);
      let after: unknown[] | undefined;
      while (true) {
        const remaining = maxResults - counts.retrievedCount;
        const size = Math.min(pageSize, remaining < Number.MAX_SAFE_INTEGER ? remaining + 1 : remaining);
        const page = await client.search(undefined, { ...body, sort, size, pit: { id: pit, keep_alive: "1m" }, ...(after ? { search_after: after } : {}) });
        if (typeof page.pit_id === "string" && page.pit_id) pit = page.pit_id;
        counts.observedCount += page.hits.hits.length;
        // In NDJSON the domain items cannot carry page metadata: warnings remain on stderr.
        try { checkCompleteness(page, { ...scoped, progress: message => {
          if (!warnings.has(message)) { warnings.add(message); context.io.error.write(message + "\n"); }
        } }, strict); }
        catch (cause) {
          if (cause instanceof CliError && cause.code === "search.partial")
            throw new CliError(cause.message, { code: cause.code, cause: cause.cause, result: { ...counts, partial: page.partial } });
          throw cause;
        }
        for (const hit of page.hits.hits) {
          if (counts.retrievedCount === maxResults)
            throw new CliError("Search exceeds the result budget.", { code: "search.budgetExceeded", result: { ...counts } });
          counts.retrievedCount++;
          yield hit;
        }
        if (page.hits.hits.length < size) break;
        const next = page.hits.hits.at(-1)?.sort;
        if (!Array.isArray(next) || next.length !== sort.length || next.at(-1) === null ||
          next.some(value => typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) ||
          JSON.stringify(next) === JSON.stringify(after))
          throw new CliError("OpenSearch returned no advancing stable search cursor.", { code: "search.invalidCursor", result: { ...counts } });
        after = next;
      }
    } catch (cause) { failed = true; failure = cause; }
    finally {
      if (pit) {
        try { await (await clientFor({ ...context, signal: AbortSignal.timeout(5000) })).deletePit(pit); }
        catch (cleanup) {
          const cause = failed ? new AggregateError([failure, cleanup], "Search and point-in-time cleanup failed.") : cleanup;
          failure = new CliError(failure instanceof CliError ? failure.message : "Point-in-time cleanup failed.", {
            code: failure instanceof CliError ? failure.code : "search.pitCleanupFailed", cause,
            result: { ...counts, ...(failure instanceof CliError && failure.result && typeof failure.result === "object" ? failure.result : {}), cleanupFailed: true },
          });
          failed = true;
          // Core may be closing a generator paused at yield: return() skips code after finally.
          throw failure;
        }
      }
    }
    if (failed) throw failure;
  });
}
