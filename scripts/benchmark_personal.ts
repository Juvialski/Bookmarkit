// Local SQLite benchmark using the actual v1.3.0 module from its immutable commit.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createPersonalCache, CacheDatabase } from '../src/services/personalCache';

async function main() {
 mkdirSync('dist/v5',{recursive:true});
 const path=resolve('dist/v5/v130-cache.ts');
 writeFileSync(path,execFileSync('git',['show','ff99812d2a850be68b96cdbb66749f82015381ea:src/services/personalCache.ts'],{encoding:'utf8'}).replaceAll("'../","'../../src/"));
 const old=await import(pathToFileURL(path).href);
 const rows=[];
 for(const size of [100,1000,5000,10000]) {
  const db=new DatabaseSync(':memory:');
  const adapter:CacheDatabase={async execAsync(sql){db.exec(sql);},async runAsync(sql,...args){return db.prepare(sql).run(...args);},
   async getFirstAsync<T>(sql:string,...args:string[]){return (db.prepare(sql).get(...args)||null) as T|null;},async getAllAsync<T>(sql:string,...args:string[]){return db.prepare(sql).all(...args) as T[];}};
  const cache=old.createPersonalCache(adapter);await cache.ready;
  db.exec('BEGIN');const insert=db.prepare('insert into personal_books values (?,?,?,?)');
  for(let i=0;i<size;i++)insert.run('hc:'+i,'',JSON.stringify({title:'Benchmark novel '+i,authors:['Benchmark Author'],hardcoverId:String(i+1),ratings:[],seriesStatus:'unknown',warnings:[]}),'2026-10-12');db.exec('COMMIT');
  const query={title:'Benchmark novel '+(size-1),author:'Benchmark Author'};
  async function measure(target:ReturnType<typeof createPersonalCache>){const times=[];for(let i=0;i<10;i++){const start=performance.now();await target.search(query);times.push(performance.now()-start);}return times.sort((a,b)=>a-b);}
  const before=await measure(cache);const current=createPersonalCache(adapter);await current.ready;const after=await measure(current);
  rows.push({books:size,beforeMedianMs:before[5],beforeP95Ms:before[9],afterMedianMs:after[5],afterP95Ms:after[9],beforeJsonRows:size,afterJsonRows:1});db.close();
 }
 writeFileSync('dist/v5/personal-comparison.json',JSON.stringify({scope:'Synthetic public-safe records; desktop Node SQLite, actual v1.3.0 code vs v5',rows},null,2)+'\n');
 console.log(JSON.stringify(rows));
}
void main();
