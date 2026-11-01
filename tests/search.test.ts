import assert from "node:assert/strict";
import test from "node:test";
import { http, HttpResponse } from "msw";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Readable} from "node:stream";
import { origin, setupExplore } from "./explore-fixture.js";

// Synthetic Search API 2.19/3.2 response; no deployment fields or captures.
const response = {
  took: 3, timed_out: false, _shards: { total: 2, successful: 2, skipped: 0, failed: 0 },
  hits: { total: { value: 1, relation: "eq" }, max_score: 1.5,
    hits: [{ _index: "sample-a", _id: "doc-1", _score: 1.5, _source: { title: "Synthetic result", category: "example" }, sort: [7] }] },
};
const partial = { timedOut: false, failedShards: 0, totalShards: 2, failures: [], totalLowerBound: false };

test("M3 simple search projects fields, sort and size and preserves JSON/RPC data", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.post(origin + "/search/:index/_search", async ({request, params}) => {
    assert.equal(params.index, "sample-*");
    assert.deepEqual(await request.json(), { query: { query_string: { query: "category:example" } }, _source: ["title", "category"], sort: [{rank:"desc"}], size: 20 });
    return HttpResponse.json(response);
  }));
  const argv = ["search", "sample-*", "--q", "category:example", "--fields", "title,category", "--sort", "rank:desc", "--size", "20"];
  const expected = { ...response, partial };
  assert.deepEqual(await fixture.json(app, argv), expected);
  const [reply] = await fixture.rpc(app, [argv]) as {result: unknown}[];
  assert.deepEqual(reply!.result, expected);
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  for (const text of ["sample-a", "doc-1", "Synthetic result", "1.5"]) assert.ok(human.stdout.includes(text));
  assert.equal(human.stderr, "");
});

test("M3 search default is one bounded page and a successful empty state", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.post(origin + "/search/sample-a/_search", async ({request}) => {
    assert.deepEqual(await request.json(), { size: 10 });
    return HttpResponse.json({ ...response, hits: { total: { value: 0, relation: "eq" }, max_score: null, hits: [] } });
  }));
  const result = await fixture.run(app, ["search", "sample-a"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /No matches/);
  assert.equal(result.stderr, "");
});

test("M3 approved invalid-query workflow retains the OpenSearch reason", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.post(origin + "/search/sample-a/_search", () => HttpResponse.json({error:{type:"search_phase_execution_exception",reason:"all shards failed",root_cause:[{type:"query_shard_exception",reason:"Synthetic query could not be parsed"}]},status:400},{status:400})));
  const result = await fixture.run(app, ["search", "sample-a", "--q", "title:(", "--json"]);
  assert.equal(result.exitCode, 1);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, "query.invalid");
  assert.match(error.cause.message, /Synthetic query could not be parsed/);
});

for (const input of ["file", "stdin"]) test(`M3 full search body from ${input} is sent unchanged`, async t => {
  const {fixture,server,app}=await setupExplore(t);
  const directory=await mkdtemp(join(tmpdir(),"opensearch-search-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const body={query:{term:{category:"example"}},sort:[{rank:"desc"}],_source:["title"],highlight:{fields:{title:{}}},size:1};
  await writeFile(join(directory,"request.json"),JSON.stringify(body));
  server.use(http.post(origin+"/search/sample-a/_search",async({request})=>{assert.deepEqual(await request.json(),body);return HttpResponse.json(response);}));
  const result=await fixture.run(app,["search","sample-a","--body-file",input==="file"?"request.json":"-","--json"],{cwd:directory,...(input==="stdin"?{input:Readable.from([JSON.stringify(body)])}:{})});
  assert.equal(result.exitCode,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{...response,partial});
  if(input==="file") {
    const [reply]=await fixture.rpc(app,[["search","sample-a","--body-file",join(directory,"request.json")]]) as {result:unknown}[];
    assert.deepEqual(reply!.result,{...response,partial});
  }
});

test("M3 approved malformed-body and mutually-exclusive-input workflows make no request",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  let requests=0;
  server.use(http.post(origin+"/search/sample-a/_search",()=>{requests++;return HttpResponse.json(response);}));
  const directory=await mkdtemp(join(tmpdir(),"opensearch-search-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,"request.json"),'{"synthetic-private-input":');
  for(const [extra,code] of [[[],"query.invalid"],[["--q","*"],"usage"]] as const) {
    const result=await fixture.run(app,["search","sample-a","--body-file",join(directory,"request.json"),...extra,"--json"]);
    assert.equal(result.exitCode,1);
    assert.equal(JSON.parse(result.stderr).error.code,code);
    assert.ok(!result.stderr.includes("synthetic-private-input"));
  }
  assert.equal(requests,0);
});

for (const signal of ["timeout", "shards", "lower-bound"]) test(`M3 partial search ${signal} is visible and strict mode retains the result`,async t=>{
  const {fixture,server,app}=await setupExplore(t);
  const failures=[{shard:1,index:"sample-a",node:"sample-node",reason:{type:"query_shard_exception",reason:"Synthetic shard unavailable"}}];
  const wire={...response,timed_out:signal==="timeout",_shards:signal==="shards"?{total:2,successful:1,skipped:0,failed:1,failures}:response._shards,
    hits:{...response.hits,total:signal==="lower-bound"?{value:10000,relation:"gte"}:response.hits.total}};
  server.use(http.post(origin+"/search/sample-a/_search",()=>HttpResponse.json(wire)));
  const value=await fixture.json(app,["search","sample-a"]);
  const human=await fixture.run(app,["search","sample-a"]);
  assert.equal(human.exitCode,0,human.stderr);
  if(signal==="timeout") {assert.equal((value as any).partial.timedOut,true);assert.match(human.stderr,/timed out/i);}
  if(signal==="shards") {assert.deepEqual((value as any).partial.failures,failures);assert.match(human.stderr,/1\/2 shards failed/);assert.match(human.stderr,/Synthetic shard unavailable/);}
  if(signal==="lower-bound") {assert.match(human.stdout,/≥ 10000/);assert.match(human.stderr,/lower bound/i);}
  const strict=await fixture.run(app,["search","sample-a","--fail-on-partial","--json"]);
  assert.equal(strict.exitCode,1);
  assert.equal(JSON.parse(strict.stderr).error.code,"search.partial");
  assert.deepEqual(JSON.parse(strict.stdout),value);
  const [reply]=await fixture.rpc(app,[["search","sample-a","--fail-on-partial"]]) as {error:{code:string,data:{result:unknown}}}[];
  assert.deepEqual(reply!.error.data.result,value);
});
