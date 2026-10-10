import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFreeGemini, parseFreeProjects } from '../src/freeGemini.mjs';
import { createGoogleFreeChecks } from '../src/googleFreeChecks.mjs';
const project = (id='authorized-one',number='123',key='fixture-key-one') => ({ id,number,keys:[key,'fixture-backup-'+id],authorized:true,billingEnabled:false,models:[{id:'gemini-2.5-flash-lite',grounding:true,freeEligible:true,verifiedAt:new Date().toISOString(),dailyLimit:5,freeRpd:500,externalUsage:0}] });
const checks={billingCheck:async()=>true,keyProjectCheck:async()=>true,modelCheck:async()=>true};
const answer=()=>Response.json({usageMetadata:{totalTokenCount:30},candidates:[{content:{parts:[{text:'Warbreaker by Brandon Sanderson.'}]},groundingMetadata:{searchEntryPoint:{renderedContent:'<div>Google</div>'},groundingChunks:[{web:{uri:'https://example.org/book',title:'Book'}}],groundingSupports:[{segment:{text:'Warbreaker'},groundingChunkIndices:[0]}]}}]});
test('paid, unverified, duplicate project and unsafe model configurations are rejected',()=>{
 const valid=project(); assert.equal(parseFreeProjects(JSON.stringify([valid])).length,1);
 for(const change of [{billingEnabled:true},{authorized:false},{number:'bad'},{models:[{...valid.models[0],id:'gemini-3.5-flash-lite'}]},{models:[{...valid.models[0],verifiedAt:'2020-01-01'}]},{models:[{...valid.models[0],freeEligible:false}]}]) assert.throws(()=>parseFreeProjects(JSON.stringify([{...valid,...change}])));
 assert.throws(()=>parseFreeProjects(JSON.stringify([valid,project('another-id','123','fixture-different')])));
});
test('multiple keys share one project reservation; requests deduplicate without retaining answers',async()=>{
 let calls=0,reserved=[];
 const search=createFreeGemini({projects:[project()],...checks,reserve:async(...args)=>{reserved.push(args);return true;},fetcher:async(_url,init)=>{calls++;assert.equal(init.headers['x-goog-api-key'],'fixture-key-one');await new Promise(r=>setTimeout(r,5));return answer();}});
 const results=await Promise.all([search('Warbreaker'),search('Warbreaker')]);assert.equal(calls,1);assert.equal(reserved.length,1);assert.equal(reserved[0][0],'authorized-one');assert.equal(results[0].status,'ok');assert.equal(results[0].rating,undefined);
 await search('Warbreaker');assert.equal(calls,2);
});
test('429 stops immediately; neither backup keys nor other projects bypass it',async()=>{
 let calls=0,cooldowns=[];
 const search=createFreeGemini({projects:[project(),project('authorized-two','456','fixture-key-two')],...checks,reserve:async()=>true,cooldown:async(...args)=>cooldowns.push(args),fetcher:async()=>{calls++;return new Response('',{status:429});}});
 assert.equal((await search('Warbreaker')).status,'quota');assert.equal(calls,1);assert.equal(cooldowns[0][3],3600);
});
test('existing verified capacity can select an independent project before any Google request',async()=>{
 let selected;
 const search=createFreeGemini({projects:[project(),project('authorized-two','456','fixture-key-two')],...checks,reserve:async id=>id==='authorized-two',fetcher:async(_url,init)=>{selected=init.headers['x-goog-api-key'];return answer();}});
 assert.equal((await search('Warbreaker')).status,'ok');assert.equal(selected,'fixture-key-two');
});
test('unverified billing, project binding, model access and missing credentials fail closed',async()=>{
 for(const override of [{billingCheck:async()=>false},{keyProjectCheck:async()=>false},{modelCheck:async()=>false}]) {
  const search=createFreeGemini({projects:[project()],...checks,...override,reserve:async()=>true,fetcher:async()=>{assert.fail('Google generation forbidden');}});
  assert.equal((await search('Warbreaker')).status,'disabled');
 }
 assert.equal((await createFreeGemini()('Warbreaker')).status,'disabled');
});
test('3.x verified free text never adds a Search tool; grounding cannot select it',async()=>{
 const p=project();p.models=[{...p.models[0],id:'gemini-3.5-flash-lite',grounding:false}];let body;
 const search=createFreeGemini({projects:[p],...checks,reserve:async()=>true,fetcher:async(_url,init)=>{body=JSON.parse(init.body);return Response.json({candidates:[{content:{parts:[{text:'Warbreaker'}]}}]});}});
 assert.equal((await search('Warbreaker','grounding')).status,'disabled');assert.equal((await search('Warbreaker','text')).status,'ok');assert.equal(body.tools,undefined);
});
test('billing verification must return the exact unbilled project and key owner',async()=>{
 const checks=createGoogleFreeChecks({accessToken:'fixture-oauth',fetcher:async url=>Response.json(url.includes('billingInfo')?{projectId:'authorized-one',billingEnabled:false}:url.includes('lookupKey')?{parent:'projects/123/locations/global',name:'projects/123/locations/global/keys/one'}:{supportedGenerationMethods:['generateContent']})});
 assert.equal(await checks.billingCheck('authorized-one'),true);assert.equal(await checks.billingCheck('wrong-project'),false);assert.equal(await checks.keyProjectCheck('fixture-key-one','123'),true);assert.equal(await checks.keyProjectCheck('fixture-key-one','456'),false);
 assert.equal(await createGoogleFreeChecks().billingCheck('authorized-one'),false);
});
test('timeouts, unavailable models and ungrounded answers never fabricate evidence',async()=>{
 const base={projects:[project()],...checks,reserve:async()=>true};
 assert.equal((await createFreeGemini({...base,fetcher:async()=>{throw new Error('timeout');}})('Warbreaker')).status,'timeout');
 assert.equal((await createFreeGemini({...base,fetcher:async()=>new Response('',{status:404})})('Warbreaker')).status,'unavailable');
 assert.equal((await createFreeGemini({...base,fetcher:async()=>Response.json({candidates:[{content:{parts:[{text:'uncited'}]}}]})})('Warbreaker')).status,'empty');
});
