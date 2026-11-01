import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {http,HttpResponse} from "msw";
import {origin,setupExplore} from "./explore-fixture.js";

const response={took:2,timed_out:false,_shards:{total:1,successful:1,skipped:0,failed:0},hits:{total:{value:7,relation:"eq"},hits:[]}};
const terms={doc_count_error_upper_bound:0,sum_other_doc_count:3,buckets:[{key:"sample",doc_count:7}]};

test("M3 aggregate terms constructs one search and renders a key/count table with error bounds",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  server.use(http.post(origin+"/search/sample-a/_search",async({request})=>{
    assert.deepEqual(await request.json(),{size:0,query:{query_string:{query:"category:*"}},aggs:{result:{terms:{field:"category",size:10}}}});
    return HttpResponse.json({...response,aggregations:{result:terms}});
  }));
  const argv=["aggregate","terms","sample-a","--field","category","--size","10","--q","category:*"];
  const human=await fixture.run(app,argv);
  assert.equal(human.exitCode,0,human.stderr);
  assert.match(human.stdout,/Key\s+Count/);
  assert.match(human.stdout,/sample\s+7/);
  assert.match(human.stdout,/sum_other_doc_count:\s+3/);
  assert.match(human.stdout,/doc_count_error_upper_bound:\s+0/);
  assert.deepEqual((await fixture.json(app,argv) as any).aggregations,{result:terms});
});

test("M3 date histogram helper uses a fixed interval and displays ISO bucket timestamps",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  server.use(http.post(origin+"/search/sample-a/_search",async({request})=>{
    assert.deepEqual(await request.json(),{size:0,aggs:{result:{date_histogram:{field:"created",fixed_interval:"1h"}}}});
    return HttpResponse.json({...response,aggregations:{result:{buckets:[{key:Date.parse("2026-01-02T03:00:00Z"),key_as_string:"02/01/2026 03:00",doc_count:7}]}}});
  }));
  const human=await fixture.run(app,["aggregate","histogram","sample-a","--field","created","--interval","1h"]);
  assert.equal(human.exitCode,0,human.stderr);
  assert.match(human.stdout,/2026-01-02T03:00:00\.000Z/);
});

test("M3 full-body nested/stats/percentile aggregations stay unchanged in JSON/RPC and render records",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  const directory=await mkdtemp(join(tmpdir(),"opensearch-aggs-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const body={aggs:{categories:{terms:{field:"category"},aggs:{amount:{stats:{field:"amount"}}}},latency:{percentiles:{field:"latency"}}}};
  const aggregations={categories:{...terms,buckets:[{key:"sample",doc_count:7,amount:{count:7,min:1,max:9,avg:5,sum:35}}]},latency:{values:{"50.0":12,"99.0":30}},stats:{count:7,min:1,max:9,avg:5,sum:35}};
  const path=join(directory,"aggs.json"); await writeFile(path,JSON.stringify(body));
  server.use(http.post(origin+"/search/sample-a/_search",async({request})=>{assert.equal(new URL(request.url).searchParams.get("size"),"0");assert.deepEqual(await request.json(),body);return HttpResponse.json({...response,aggregations});}));
  const argv=["search","sample-a","--body-file",path,"--size","0"];
  const value=await fixture.json(app,argv) as any;
  assert.deepEqual(value.aggregations,aggregations);
  const [reply]=await fixture.rpc(app,[argv]) as {result:unknown}[];
  assert.deepEqual(reply!.result,value);
  const human=await fixture.run(app,argv);
  assert.equal(human.exitCode,0,human.stderr);
  assert.match(human.stdout,/50\.0:\s+12/);
  assert.match(human.stdout,/avg:\s+5/);
});

test("M3 aggregation helpers apply the same partial-result policy",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  server.use(http.post(origin+"/search/sample-a/_search",()=>HttpResponse.json({...response,timed_out:true,aggregations:{result:terms}})));
  const result=await fixture.run(app,["aggregate","terms","sample-a","--field","category","--fail-on-partial","--json"]);
  assert.equal(result.exitCode,1);
  assert.equal(JSON.parse(result.stderr).error.code,"search.partial");
  assert.deepEqual(JSON.parse(result.stdout).aggregations,{result:terms});
});
