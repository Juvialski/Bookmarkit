import { createHardcoverService } from '../_shared/hardcover-service.mjs';
import { boundedJson, LookupError } from '../_shared/hardcover.mjs';

const base=Deno.env.get('SUPABASE_URL') || '';
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const publishable=Object.values(JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}'));
async function api(path: string, body?: object) {
  const response=await fetch(base+'/rest/v1/'+path,{method:body?'POST':'GET',
    headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(1800)});
  if(!response.ok) { await response.body?.cancel(); throw new LookupError(503); }
  if(response.status===204 || response.headers.get('content-length')==='0') return null;
  return boundedJson(response);
}
const lookup=createHardcoverService({token:Deno.env.get('HARDCOVER_API_TOKEN') || '',store:{
  get:async(key: string,query: {title?: string;author?: string})=>{
    const direct=(await api('hardcover_cache?select=payload,expires_at&cache_key=eq.'+key))[0];
    if(direct || !query.title || !query.author) return direct;
    const rows=await api('hardcover_cache?select=payload,expires_at&title=eq.'+encodeURIComponent(query.title)+
      '&primary_author=eq.'+encodeURIComponent(query.author)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=9');
    if(!rows.length || rows.length>=9 || new Set(rows.map((r: {payload:{hardcoverId:string}})=>r.payload.hardcoverId)).size!==1) return null;
    rows.sort((a: {expires_at:string},b: {expires_at:string})=>Date.parse(b.expires_at)-Date.parse(a.expires_at));
    const result=rows[0]; const payload={...result.payload,identity:'work'};
    delete payload.isbn; delete payload.hardcoverEditionId;
    return {...result,payload};
  },
  reserve:(key: string,request: object,cost: number)=>api('rpc/reserve_hardcover',{key,request,cost}),
  put:(key: string,request: object,record: object)=>api('rpc/put_hardcover',{key,request,record}),
  finish:(key: string,seconds: number)=>api('rpc/finish_hardcover',{key,seconds}),
  cooldown:(seconds: number)=>api('rpc/cooldown_hardcover',{seconds}),
}});
Deno.serve(async req=>{
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  const reply=(status: number,body: object)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return reply(405,{error:'Method not allowed.'});
  // Publishable key is caller admission, not a secret or user authorization.
  // Global DB budgets/leases protect the shared server PAT against public abuse.
  if(!publishable.includes(req.headers.get('apikey'))) return reply(401,{error:'Unauthorized.'});
  try {
    if(!req.body) return reply(400,{error:'Invalid query.'});
    const input=await boundedJson(new Response(req.body),2048,AbortSignal.timeout(1000));
    return reply(200,await lookup(input));
  } catch(error) { return reply(error instanceof LookupError?error.status:503,{error:'Book service temporarily unavailable.'}); }
});
