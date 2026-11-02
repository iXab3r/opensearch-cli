import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {http,HttpResponse} from "msw";
import {origin,setupExplore} from "./explore-fixture.js";

async function queryFile(t:test.TestContext) {
  const directory=await mkdtemp(join(tmpdir(),"opensearch-review-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,"query.json");await writeFile(path,JSON.stringify({query:{match_all:{}}}));return path;
}

test("bug607 validation diagnostics are safe on all output surfaces",async t=>{
  // WHAT: independent review604 reproduced credentials in native validation error strings.
  // HOW: exercise the real command tree with planted diagnostic values, retaining result structure.
  const {fixture,server,app}=await setupExplore(t);const path=await queryFile(t);
  const secret="synthetic-validation-secret",nested="synthetic-shard-secret";
  server.use(http.post(origin+"/search/sample-a/_validate/query",()=>HttpResponse.json({valid:false,error:`Synthetic parser token=${secret}`,explanations:[{index:"sample-a",shard:0,valid:false,error:`Synthetic shard password=${nested}`}]})));
  const argv=["query","validate","sample-a","--body-file",path,"--explain"];
  const value=await fixture.json(app,argv) as any;assert.equal(value.valid,false);assert.equal(value.explanations[0].shard,0);
  for(const result of [value,await app.execute(argv),await fixture.rpc(app,[argv]),await fixture.run(app,argv)]){
    const text=JSON.stringify(result);assert.ok(!text.includes(secret));assert.ok(!text.includes(nested));
  }
  const human=await fixture.run(app,argv);assert.equal(human.exitCode,0,human.stderr);assert.match(human.stdout,/Synthetic parser/);
});

test("bug609 default validation retains native invalid-query errors in human and JSON",async t=>{
  // WHAT: independent review604 reproduced explain=false dropping invalid-query diagnostics.
  // HOW: a native-shaped response suppresses its error unless requested; inspect the human view too.
  const {fixture,server,app}=await setupExplore(t);const path=await queryFile(t);
  server.use(http.post(origin+"/search/sample-a/_validate/query",({request})=>HttpResponse.json({valid:false,...(new URL(request.url).searchParams.get("explain")==="true"?{error:"Synthetic invalid query"}:{})})));
  const argv=["query","validate","sample-a","--body-file",path];
  const value=await fixture.json(app,argv) as any;assert.equal(value.valid,false);assert.equal(value.error,"Synthetic invalid query");
  const human=await fixture.run(app,argv);assert.equal(human.exitCode,0,human.stderr);assert.match(human.stdout,/Synthetic invalid query/);
});

test("bug610 explain requests query rewriting on every shard",async t=>{
  // WHAT: independent review604 found --explain sampled a shard without rewriting the query.
  // HOW: assert actual HTTP parameters independently of the synthetic valid response.
  const {fixture,server,app}=await setupExplore(t);const path=await queryFile(t);let parameters:URLSearchParams|undefined;
  server.use(http.post(origin+"/search/sample-a/_validate/query",({request})=>{parameters=new URL(request.url).searchParams;return HttpResponse.json({valid:true,explanations:[{index:"sample-a",shard:0,valid:true,explanation:"*:*"}]});}));
  await fixture.json(app,["query","validate","sample-a","--body-file",path,"--explain"]);
  assert.equal(parameters?.get("explain"),"true");assert.equal(parameters?.get("rewrite"),"true");assert.equal(parameters?.get("all_shards"),"true");
});

test("bug608 failed query writes preserve counts with safe failure causes on all surfaces",async t=>{
  // WHAT: independent review605 reproduced raw failure credentials in the operation's failed result.
  // HOW: both commands share the native boundary; inspect CLI, execute and RPC failed-result data.
  const {fixture,server,app}=await setupExplore(t);
  await app.execute(["permissions","grant","Update"]);await app.execute(["permissions","grant","Delete"]);
  const secret="synthetic-operation-secret";
  const wire={total:1,created:0,updated:0,deleted:0,version_conflicts:1,failures:[{index:"sample-a",id:"a",status:409,cause:{type:"version_conflict_engine_exception",reason:`Synthetic failure token=${secret}`,caused_by:{type:"synthetic_exception",reason:`Synthetic nested password=${secret}`}}}]};
  server.use(http.post(origin+"/search/_reindex",()=>HttpResponse.json(wire)),http.post(origin+"/search/sample-a/_delete_by_query",()=>HttpResponse.json(wire)));
  for(const argv of [["reindex","--source","sample-a","--dest","sample-b","--wait"],["docs","delete-by-query","sample-a","--q","title:example","--wait"]]) {
    const run=await fixture.run(app,[...argv,"--json"]);assert.equal(run.exitCode,1);assert.equal(JSON.parse(run.stderr).error.code,"operation.partial");
    const value=JSON.parse(run.stdout);assert.equal(value.total,1);assert.equal(value.failures[0].status,409);assert.ok(!JSON.stringify(run).includes(secret));
    const human=await fixture.run(app,argv);assert.equal(human.exitCode,1);assert.match(human.stdout,/Synthetic failure/);assert.ok(!JSON.stringify(human).includes(secret));
    const [reply]=await fixture.rpc(app,[argv]) as any[];assert.equal(reply.error.data.result.total,1);assert.ok(!JSON.stringify(reply).includes(secret));
    await assert.rejects(app.execute(argv),(error:any)=>{assert.equal(error.code,"operation.partial");assert.equal(error.result.total,1);assert.ok(!JSON.stringify(error.result).includes(secret));return true;});
  }
});
