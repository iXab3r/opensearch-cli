import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {http,HttpResponse} from "msw";
import {origin,setupExplore} from "./explore-fixture.js";

async function inputFile(t:test.TestContext,content:string) {
  const directory=await mkdtemp(join(tmpdir(),"opensearch-round2-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,"actions.ndjson");await writeFile(path,content);return path;
}

test("bug613 completed task operation results retain safe diagnostic causes and reasons",async t=>{
  // WHAT: independent review611/612 reproduced completed task failure credentials on every surface.
  // HOW: read a native completed operation response through CLI, execute and persistent RPC.
  const {fixture,server,app}=await setupExplore(t);const secret="synthetic-background-secret";
  const diagnostic={type:"synthetic_exception",reason:`Synthetic background failure token=${secret}`};
  server.use(http.get(origin+"/search/_tasks/node-a:7",()=>HttpResponse.json({completed:true,task:{node:"node-a",id:7},response:{total:2,created:0,failures:[{index:"sample-a",id:"a",cause:diagnostic},{index:"sample-a",shard:0,reason:diagnostic}]}})));
  const argv=["tasks","show","node-a:7"];
  for(const value of [await fixture.json(app,argv),await app.execute(argv),await fixture.rpc(app,[argv]),await fixture.run(app,argv)])assert.ok(!JSON.stringify(value).includes(secret));
  const value=await fixture.json(app,argv) as any;assert.equal(value.completed,true);assert.equal(value.response.total,2);assert.equal(value.response.failures.length,2);
  const human=await fixture.run(app,argv);assert.equal(human.exitCode,0,human.stderr);assert.match(human.stdout,/Synthetic background failure/);
});

test("bug614 native search failure reasons are safe in synchronous operation results",async t=>{
  // WHAT: independent review612 reproduced the alternative native failures[].reason diagnostic shape.
  // HOW: both query writes preserve failed results across human/JSON/execute/RPC without planted values.
  const {fixture,server,app}=await setupExplore(t);const secret="synthetic-scroll-secret";
  await app.execute(["permissions","grant","Update"]);await app.execute(["permissions","grant","Delete"]);
  const response={total:2,created:0,deleted:0,failures:[{index:"sample-a",shard:0,node:"node-a",reason:{type:"search_exception",reason:`Synthetic scroll token=${secret}`,caused_by:{type:"synthetic_exception",reason:`Synthetic nested password=${secret}`}}}]};
  server.use(http.post(origin+"/search/_reindex",()=>HttpResponse.json(response)),http.post(origin+"/search/sample-a/_delete_by_query",()=>HttpResponse.json(response)));
  for(const argv of [["reindex","--source","sample-a","--dest","sample-b","--wait"],["docs","delete-by-query","sample-a","--q","title:example","--wait"]]) {
    const json=await fixture.run(app,[...argv,"--json"]);assert.equal(json.exitCode,1);assert.equal(JSON.parse(json.stdout).total,2);assert.ok(!JSON.stringify(json).includes(secret));
    const human=await fixture.run(app,argv);assert.equal(human.exitCode,1);assert.match(human.stdout,/Synthetic scroll/);assert.ok(!JSON.stringify(human).includes(secret));
    const [reply]=await fixture.rpc(app,[argv]) as any[];assert.equal(reply.error.data.result.failures[0].shard,0);assert.ok(!JSON.stringify(reply).includes(secret));
    await assert.rejects(app.execute(argv),(error:any)=>{assert.equal(error.code,"operation.partial");assert.equal(error.result.total,2);assert.ok(!JSON.stringify(error.result).includes(secret));return true;});
  }
});

test("bug615 a native missing-document bulk delete is successful",async t=>{
  // WHAT: independent review612 reproduced a native successful delete outcome counted as a failure.
  // HOW: bulk run consumes the official status404/result:not_found/errors:false wire shape.
  const {fixture,server,app}=await setupExplore(t);await app.execute(["permissions","grant","Update"]);await app.execute(["permissions","grant","Delete"]);
  const path=await inputFile(t,'{"delete":{"_index":"sample-a","_id":"missing"}}\n');
  server.use(http.post(origin+"/search/_bulk",()=>HttpResponse.json({errors:false,took:1,items:[{delete:{_index:"sample-a",_id:"missing",status:404,result:"not_found"}}]})));
  const value=await fixture.json(app,["bulk","run","--file",path]) as any;assert.equal(value.succeeded,1);assert.equal(value.failed,0);assert.deepEqual(value.failures,[]);
});

test("bug616 later bulk request failure retains known report and unconfirmed batch",async t=>{
  // WHAT: independent review612 reproduced known results disappearing when a later batch returns503.
  // HOW: real input has three batches; retain first failure, mark second unconfirmed and leave third unsent.
  const {fixture,server,app}=await setupExplore(t);await app.execute(["permissions","grant","Update"]);
  const path=await inputFile(t,'{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n');let calls=0;
  server.use(http.post(origin+"/search/sample-a/_bulk",()=>{calls++;return calls===1?HttpResponse.json({took:2,errors:true,items:[{index:{_id:"a",status:400,error:{type:"mapper_parsing_exception",reason:"Synthetic mapping failure"}}}]}):HttpResponse.json({error:{type:"unavailable_exception",reason:"Synthetic unavailable"},status:503},{status:503});}));
  const argv=["bulk","load","sample-a","--file",path,"--id-field","id","--batch-size","1"];
  const check=(report:any)=>{assert.equal(report.succeeded,0);assert.equal(report.failed,1);assert.equal(report.took,2);assert.equal(report.unconfirmedCount,1);assert.equal(report.remainingCount,1);assert.deepEqual(report.failures,[{line:1,_id:"a",status:400,reason:"Synthetic mapping failure"}]);assert.equal(calls,2);};
  const json=await fixture.run(app,[...argv,"--json"]);assert.equal(json.exitCode,1);assert.ok(json.stdout,"Known results must remain available");check(JSON.parse(json.stdout));assert.equal(JSON.parse(json.stderr).error.code,"bulk.requestFailed");assert.equal(JSON.parse(json.stderr).error.cause.code,"http.serverError");
  calls=0;const human=await fixture.run(app,argv);assert.equal(human.exitCode,1);assert.match(human.stdout,/Synthetic mapping failure/);assert.match(human.stdout,/Unconfirmed/);assert.equal(calls,2);
  calls=0;const [reply]=await fixture.rpc(app,[argv]) as any[];check(reply.error.data.result);
  calls=0;await assert.rejects(app.execute(argv),(error:any)=>{assert.equal(error.code,"bulk.requestFailed");check(error.result);return true;});
});
