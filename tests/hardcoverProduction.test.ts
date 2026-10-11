import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHardcoverWork,hardcoverSearch} from '../src/services/providers/hardcover';
import {createProgressiveLookup} from '../src/services/progressiveLookup';
import {mergeEnrichment} from '../src/services/enrichBook';
import {lookupBook} from '../src/services/bookLookup';
import {primaryRating} from '../src/utils/ratings';
import {BookResult} from '../src/models/book';
import {normalizeLocalRecord} from '../src/services/localCatalog';
import {ratingScore,starFills} from '../src/utils/starRating';
const isbn='9780765326355';
const payload={found:true,verified:true,identity:'work',ratingScope:'work',title:'The Way of Kings',authors:['Brandon Sanderson'],hardcoverId:'123',rating:4.56,ratingsCount:18432};
const query={title:payload.title,author:payload.authors[0]};
const book:BookResult={title:payload.title,authors:payload.authors,isbn,seriesStatus:'unknown',ratings:[],warnings:[]};
test('strict title/primary author work adapter cannot invent an ISBN or select conflicting metadata',()=>{
 const result=normalizeHardcoverWork(payload,query)!;
 assert.equal(result.identity,'work');assert.equal(result.isbn,undefined);assert.equal(result.rating.count,18432);
 for(const patch of [{title:'Other title'},{authors:['Other author']},{isbn},{verified:false}]) assert.throws(()=>normalizeHardcoverWork({...payload,...patch},query));
 assert.equal(normalizeHardcoverWork({found:false,ambiguous:true},query),null);
});
test('title search sends only a public project key and fixed identity, no provider token',async()=>{
 let calls=0;
 const response=await hardcoverSearch(query,async(url,init)=>{
  calls++;assert.equal(url,'https://proxy.example/functions/v1/hardcover');
  assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),query);
  assert.equal((init?.headers as Record<string,string>).Authorization,undefined);
  return Response.json(payload);
 },undefined,'https://proxy.example/functions/v1/hardcover');
 assert.equal(calls,1);assert.equal(response[0].ratings[0].count,18432);assert.equal(ratingScore(response[0].ratings[0]),'4.56');
});
test('cache response source/count, Goodreads priority and malformed offline metadata isolation',()=>{
 const hc=normalizeHardcoverWork(payload,query)!.rating;
 const gr={provider:'Goodreads' as const,verified:true,average:4.47,count:101,scope:'work' as const};
 assert.equal(primaryRating([hc,gr])?.provider,'Goodreads');assert.equal(ratingScore(gr),'4.47');
 assert.deepEqual(starFills(4.56).map(n=>Math.round(n*100)),[100,100,100,100,56]);
 const row={isbn13:isbn,title:book.title,authors:JSON.stringify(book.authors),work_id:'/works/OL1W',rating:4,rating_count:2,hardcover_json:JSON.stringify([{...payload,isbn,olWorkId:'/works/OL1W'}])};
 assert.equal(primaryRating(normalizeLocalRecord(row,isbn)!.ratings)?.provider,'Hardcover');
 assert.equal(normalizeLocalRecord({...row,hardcover_json:'malformed'},isbn)!.ratings[0].provider,'Open Library');
});
test('unrelated Hardcover cannot replace a correct existing ISBN work',async()=>{
 const reference={...book,rating:{provider:'Open Library' as const,average:4,count:10}};
 const wrong={...reference,title:'Different title',rating:{provider:'Hardcover' as const,average:5,count:100}};
 const result=await lookupBook(isbn,[async()=>reference,async()=>wrong]);
 assert.equal(result.title,book.title);assert.equal(primaryRating(result.ratings)?.provider,'Open Library');
 assert.equal(mergeEnrichment({...book,isbn:undefined},[{...book,isbn:undefined,authors:['Other author'],ratings:[wrong.rating]}]).ratings.length,0);
});
test('metadata renders without waiting for a slow rating and enrichment reuses the request',async()=>{
 let finish:(value:any)=>void=()=>{};let calls=0;
 const progressive=createProgressiveLookup(async()=>null,[async()=>({...book,rating:{provider:'Open Library' as const}}),
  ()=>{calls++;return new Promise(resolve=>{finish=resolve;});}]);
 const first=await progressive.lookup(isbn);assert.equal(first.title,book.title);assert.equal(first.ratings[0].average,undefined);
 finish({...book,rating:{provider:'Hardcover',average:4.56,count:18432}});
 const enriched=await progressive.enrich(first);assert.equal(primaryRating(enriched.ratings)?.provider,'Hardcover');assert.equal(calls,1);
});
