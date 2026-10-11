import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHardcoverService,normalizeCandidates,queryKey,validateQuery} from '../../supabase/functions/_shared/hardcover-service.mjs';
const isbn='9780765326355';
const book={id:123,title:'The Way of Kings',slug:'the-way-of-kings',rating:4.56,ratings_count:18432,
 contributions:[{contribution:'author',author:{name:'Brandon Sanderson'}}],featured_book_series:{compilation:false,position:1,series:{name:'Stormlight'}}};
const edition={id:9,book_id:123,isbn_13:isbn,title:book.title,book};
function memoryStore(time=()=>0) {
 const rows=new Map();const events=[];
 return {rows,events,get:async key=>rows.get(key),reserve:async(...args)=>{events.push(['reserve',...args]);return true;},
  put:async(key,query,payload)=>{events.push(['put']);rows.set(key,{payload,expires_at:new Date(time()+604800000).toISOString()});},
  finish:async(...args)=>events.push(['finish',...args]),cooldown:async seconds=>events.push(['cooldown',seconds])};
}
test('ISBN edition parent, exact work pair, persistent cache and deduplication',async()=>{
 let calls=0;const store=memoryStore();
 const lookup=createHardcoverService({token:'test-only',store,now:()=>0,fetcher:async()=>{calls++;return Response.json({data:{editions:[edition]}});}});
 const [a,b]=await Promise.all([lookup({isbn}),lookup({isbn})]);
 assert.equal(calls,1);assert.equal(a.hardcoverId,'123');assert.equal(a.ratingScope,'work');assert.equal(b.ratingsCount,18432);
 assert.equal((await lookup({isbn})).cacheHit,true);assert.equal(calls,1);
 store.rows.get(await queryKey({isbn})).expires_at=new Date(0).toISOString();
 await lookup({isbn});assert.equal(calls,2);
});
test('title/primary-author search hydrates IDs; work result has no fabricated ISBN',async()=>{
 const store=memoryStore();const seen=[];
 const lookup=createHardcoverService({token:'test-only',store,now:()=>0,fetcher:async(_url,init)=>{
  const q=JSON.parse(init.body);seen.push(q);
  return Response.json({data:{books:[book]}});
 }});
 const result=await lookup({title:book.title,author:'Brandon Sanderson'});
 assert.equal(result.identity,'work');assert.equal(result.isbn,undefined);assert.equal(result.rating,4.56);
 assert.equal(seen.length,1);assert.equal(store.events[0][3],1);assert.deepEqual(seen[0].variables,{title:book.title,author:'Brandon Sanderson'});
});
test('conflicting authors/titles, translations and duplicate work identities are rejected',()=>{
 const query={title:book.title,author:'Brandon Sanderson'};
 for(const altered of [{...book,title:'Another book'},{...book,contributions:[{author:{name:'Other Writer'}}]}]) {
  assert.equal(normalizeCandidates({data:{books:[altered]}},query,[123]).found,false);
 }
 assert.equal(normalizeCandidates({data:{books:[book,{...book,id:456}]}},query,[123,456]).ambiguous,true);
 assert.throws(()=>normalizeCandidates({data:{books:[book,{...book,rating:1}]}},query,[123]));
 assert.equal(normalizeCandidates({data:{books:[book,{...book,id:456,book_status_id:4}]}},query,[123,456]).hardcoverId,'123');
});
test('invalid inputs, missing token, lease denial never request upstream',async()=>{
 for(const input of [{title:'Only title'}, {isbn:'9780765326356'}, {isbn,query:'mutation'}, {title:'',author:'X'}]) assert.throws(()=>validateQuery(input));
 let calls=0;const store=memoryStore(),fetcher=async()=>{calls++;throw Error('secret');};
 await assert.rejects(createHardcoverService({store,fetcher})({isbn}),e=>e.status===503);
 store.reserve=async()=>false;
 await assert.rejects(createHardcoverService({token:'test',store,fetcher})({isbn}),e=>e.status===429);assert.equal(calls,0);
});
test('429 and exhausted daily headers persist a cooldown without retrying or leaking errors',async()=>{
 let calls=0;const store=memoryStore();
 const lookup=createHardcoverService({token:'test-secret',store,fetcher:async()=>{calls++;return new Response('private test-secret',{status:429,headers:{'Retry-After':'120',RateLimit:'"daily";r=0;t=3600'}});}});
 await assert.rejects(lookup({isbn}),e=>e.status===429&&!e.message.includes('secret'));
 assert.equal(calls,1);assert.ok(store.events.some(e=>e[0]==='cooldown'&&e[1]===120));assert.ok(store.events.some(e=>e[0]==='cooldown'&&e[1]===3600));
});
test('deadline, oversized and malformed upstream bodies fail closed',async context=>{
 for(const body of ['bad JSON','x'.repeat(65537)]) await assert.rejects(createHardcoverService({token:'test',store:memoryStore(),fetcher:async()=>new Response(body)})({isbn}));
 const lookup=createHardcoverService({token:'test',store:memoryStore(),timeoutMs:5,
  fetcher:async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('secret'))))});
 await assert.rejects(lookup({isbn}),e=>e.status===504);
});
