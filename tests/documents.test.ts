import assert from "node:assert/strict";
import test from "node:test";
import {http,HttpResponse} from "msw";
import {origin,setupExplore} from "./explore-fixture.js";

const document={_index:"sample-a",_id:"doc-1",_version:3,_seq_no:7,_primary_term:1,found:true,_source:{title:"Synthetic document",nested:{value:42}}};

test("M3 docs get returns document source and complete metadata in human/JSON/RPC",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  server.use(http.get(origin+"/search/sample-a/_doc/doc-1",()=>HttpResponse.json(document)));
  assert.deepEqual(await fixture.json(app,["docs","get","sample-a","doc-1"]),document);
  const [reply]=await fixture.rpc(app,[["docs","get","sample-a","doc-1"]]) as {result:unknown}[];
  assert.deepEqual(reply!.result,document);
  const human=await fixture.run(app,["docs","get","sample-a","doc-1"]);
  assert.equal(human.exitCode,0,human.stderr);
  assert.match(human.stdout,/Synthetic document/);
  assert.match(human.stdout,/_version:\s+3/);
});

test("M3 docs get batches IDs once and reports a missing item per ID",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  let calls=0;
  const missing={_index:"sample-a",_id:"doc-2",found:false};
  server.use(http.post(origin+"/search/sample-a/_mget",async({request})=>{
    calls++;assert.deepEqual(await request.json(),{ids:["doc-1","doc-2"]});
    return HttpResponse.json({docs:[document,missing]});
  }));
  assert.deepEqual(await fixture.json(app,["docs","get","sample-a","doc-1","doc-2"]),[document,missing]);
  assert.equal(calls,1);
});

test("M3 approved missing single document has document.notFound",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  server.use(http.get(origin+"/search/sample-a/_doc/doc-2",()=>HttpResponse.json({_index:"sample-a",_id:"doc-2",found:false},{status:404})));
  const result=await fixture.run(app,["docs","get","sample-a","doc-2","--json"]);
  assert.equal(result.exitCode,1);
  assert.equal(JSON.parse(result.stderr).error.code,"document.notFound");
});

test("M3 docs exists maps HEAD status to a boolean for present and missing documents",async t=>{
  const {fixture,server,app}=await setupExplore(t);
  server.use(http.head(origin+"/search/sample-a/_doc/:id",({params})=>new HttpResponse(null,{status:params.id==="doc-1"?200:404})));
  assert.equal(await fixture.json(app,["docs","exists","sample-a","doc-1"]),true);
  assert.equal(await fixture.json(app,["docs","exists","sample-a","doc-2"]),false);
});
