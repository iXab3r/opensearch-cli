import {command, formatHuman, integerParser, recordView, type CommandDefinition} from "@eyeauras/cli-factory";
import {clientFor, type SearchResult} from "./client.js";

/** One page uses the standard search API; Core renders every output format. */
export function searchCommand(): CommandDefinition {
  return command("search <index>", "Search documents and inspect matching hits", async ({args,options}, context) => {
    const body: Record<string,unknown> = {};
    if (options.q !== undefined) body.query = {query_string:{query:options.q}};
    if (options.fields !== undefined) body._source = String(options.fields).split(",").map(field=>field.trim());
    if (options.sort !== undefined) body.sort = String(options.sort).split(",").map(field=> {
      const match = /^(.*):(asc|desc)$/.exec(field);
      return match ? {[match[1]!]:match[2]} : field;
    });
    body.size = options.size ?? 10;
    return (await clientFor(context)).search(args.index,body);
  }, {permission:"ReadOnly",options:[
    {flags:"--q <query>",description:"Match a Lucene query string"},
    {flags:"--fields <fields>",description:"Select comma-separated source fields"},
    {flags:"--sort <fields>",description:"Sort by comma-separated field:asc or field:desc"},
    {flags:"--size <count>",description:"Limit hits in this page (default 10)",parse:integerParser({min:0,max:Number.MAX_SAFE_INTEGER,signed:false,errorMessage:"Size must be a non-negative integer."})},
  ],view:recordView<SearchResult>({fields:[
    {label:"Total",value:value=>value.hits.total ? `${value.hits.total.relation === "gte" ? "≥ " : ""}${value.hits.total.value}` : undefined},
    {label:"Took (ms)",value:value=>value.took},
  ],sections:[{title:()=>"Hits",lines:value=>value.hits.hits.length ? value.hits.hits.map(hit=>formatHuman(hit)) : ["No matches."]}]})});
}
