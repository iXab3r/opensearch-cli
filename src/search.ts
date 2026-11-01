import {CliError, command, formatHuman, integerParser, recordView, type CommandContext, type CommandDefinition, type HumanView} from "@eyeauras/cli-factory";
import {clientFor, type SearchResult} from "./client.js";
import {readQuery} from "./query.js";

/** Search and aggregation commands share the same completeness policy on every surface. */
export function checkSearchCompleteness(value: SearchResult, context: CommandContext, strict: boolean): SearchResult {
  const warnings: string[] = [];
  if (value.partial.timedOut) warnings.push("Search timed out.");
  if (value.partial.failedShards) {
    const reasons = value.partial.failures.slice(0,3).map(failure=>failure.reason?.reason).filter(Boolean).join("; ").replace(/[\r\n\t]+/g," ");
    warnings.push(`${value.partial.failedShards}/${value.partial.totalShards} shards failed.${reasons ? " "+reasons : ""}`);
  }
  if (value.partial.totalLowerBound) warnings.push("The total is a lower bound.");
  if (warnings.length) {
    if (strict) throw new CliError("Search results are incomplete.",{code:"search.partial",result:value,cause:new Error(warnings.join(" "))});
    context.progress("Warning: "+warnings.join(" "));
  }
  return value;
}

/** Core formats the records and bucket table; the product selects OpenSearch fields. */
export function searchView(dateHistogram = false): HumanView {
  return recordView<SearchResult>({fields:[
    {label:"Total",value:value=>value.hits.total ? `${value.hits.total.relation === "gte" ? "≥ " : ""}${value.hits.total.value}` : undefined},
    {label:"Took (ms)",value:value=>value.took},
  ],sections:[
    {title:()=>"Hits",lines:value=>value.hits.hits.length ? value.hits.hits.map(hit=>formatHuman(hit)) : value.aggregations ? undefined : ["No matches."]},
    {title:()=>"Aggregations",lines:value=>value.aggregations ? Object.entries(value.aggregations).flatMap(([name,aggregation])=>{
      if (!aggregation || typeof aggregation !== "object" || Array.isArray(aggregation)) return [name,formatHuman(aggregation)];
      const {buckets,...metadata}=aggregation as Record<string,unknown>;
      if (!Array.isArray(buckets)) return [name,formatHuman(aggregation)];
      const rows=buckets.map((bucket:Record<string,unknown>)=>({Key:dateHistogram && typeof bucket.key === "number" ? new Date(bucket.key).toISOString() : bucket.key_as_string ?? bucket.key,Count:bucket.doc_count}));
      return [name,...(Object.keys(metadata).length ? [formatHuman(metadata)] : []),rows.length ? formatHuman(rows) : "No buckets."];
    }) : undefined},
  ]});
}

/** One page uses the standard search API; Core renders every output format. */
export function searchCommand(): CommandDefinition {
  return command("search <index>", "Search documents and inspect matching hits", async ({args,options}, context) => {
    if (options.bodyFile !== undefined) {
      if (options.q !== undefined) throw new CliError("Choose --q or --body-file.", {code:"usage"});
      const body = await readQuery(String(options.bodyFile),context);
      const parameters: Record<string,string> = {};
      if (options.size !== undefined) parameters.size = String(options.size);
      if (options.fields !== undefined) parameters._source = String(options.fields);
      if (options.sort !== undefined) parameters.sort = String(options.sort);
      return checkSearchCompleteness(await (await clientFor(context)).search(args.index,body,parameters),context,options.failOnPartial === true);
    }
    const body: Record<string,unknown> = {};
    if (options.q !== undefined) body.query = {query_string:{query:options.q}};
    if (options.fields !== undefined) body._source = String(options.fields).split(",").map(field=>field.trim());
    if (options.sort !== undefined) body.sort = String(options.sort).split(",").map(field=> {
      const match = /^(.*):(asc|desc)$/.exec(field);
      return match ? {[match[1]!]:match[2]} : field;
    });
    body.size = options.size ?? 10;
    return checkSearchCompleteness(await (await clientFor(context)).search(args.index,body),context,options.failOnPartial === true);
  }, {permission:"ReadOnly",options:[
    {flags:"--q <query>",description:"Match a Lucene query string"},
    {flags:"--body-file <path>",description:"Read a search body from file or -"},
    {flags:"--fail-on-partial",description:"Fail on incomplete results or lower totals"},
    {flags:"--fields <fields>",description:"Select comma-separated source fields"},
    {flags:"--sort <fields>",description:"Sort by comma-separated field:asc or field:desc"},
    {flags:"--size <count>",description:"Limit hits in this page (default 10)",parse:integerParser({min:0,max:Number.MAX_SAFE_INTEGER,signed:false,errorMessage:"Size must be a non-negative integer."})},
  ],view:searchView()});
}

/** Convenience aggregations are ordinary size-zero searches under ReadOnly permission. */
export function aggregateCommand(): CommandDefinition {
  return command("aggregate","Summarize matching documents",["terms","histogram"].map(kind=>command(`${kind} <index>`,kind === "terms" ? "Group values into count buckets" : "Group dates into fixed-interval buckets",async({args,options},context)=>{
    const aggregation=kind === "terms" ? {terms:{field:options.field,size:options.size ?? 10}} : {date_histogram:{field:options.field,fixed_interval:options.interval}};
    const body={size:0,...(options.q === undefined ? {} : {query:{query_string:{query:options.q}}}),aggs:{result:aggregation}};
    return checkSearchCompleteness(await (await clientFor(context)).search(String(args.index),body),context,options.failOnPartial === true);
  },{permission:"ReadOnly",options:[
    {flags:"--field <field>",description:"Select the field to aggregate",required:true},
    ...(kind === "terms" ? [{flags:"--size <count>",description:"Limit buckets (default 10)",parse:integerParser({min:1,max:Number.MAX_SAFE_INTEGER,signed:false,errorMessage:"Bucket size must be a positive integer."})}] : [{flags:"--interval <duration>",description:"Set a fixed date histogram interval",required:true}]),
    {flags:"--q <query>",description:"Match a Lucene query string"},
    {flags:"--fail-on-partial",description:"Fail on incomplete results or lower totals"},
  ],view:searchView(kind === "histogram")})));
}
