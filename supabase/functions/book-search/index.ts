import { createFreeGemini, parseFreeProjects } from './freeGemini.mjs';
import { createGoogleFreeChecks } from './googleFreeChecks.mjs';
const url = Deno.env.get('SUPABASE_URL')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const auth = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
async function rpc(name: string, body: unknown) {
 const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:auth,body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});
 if(!response.ok) throw new Error('Usage store unavailable');return response.json();
}
let projects = [];
try { if(Deno.env.get('GEMINI_ENABLED')==='true') projects=parseFreeProjects(Deno.env.get('GEMINI_FREE_PROJECTS_JSON')); } catch { projects=[]; }
const checks=createGoogleFreeChecks({ serviceAccount:Deno.env.get('GOOGLE_VERIFIER_SERVICE_ACCOUNT_JSON'),accessToken:Deno.env.get('GOOGLE_VERIFIER_ACCESS_TOKEN') });
const search=createFreeGemini({projects,...checks,
 reserve:async (project: string,model: string,task: string,limit: number)=>rpc('reserve_free_gemini',{p_project:project,p_model:model,p_task:task,p_limit:limit}),
 cooldown:async (project: string,model: string,task: string,seconds: number)=>rpc('cooldown_free_gemini',{p_project:project,p_model:model,p_task:task,p_seconds:seconds}),
 recordUsage:async (project: string,model: string,task: string,tokens: number)=>rpc('record_free_gemini',{p_project:project,p_model:model,p_task:task,p_tokens:tokens})
});
Deno.serve(async req => {
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return new Response('{}',{status:405,headers});
 if(Number(req.headers.get('content-length')||'0')>2048)return new Response('{}',{status:413,headers});
 try {
  const raw=await req.text();if(raw.length>2048)return new Response('{}',{status:413,headers});const body=JSON.parse(raw);
  if(!projects.length)return new Response(JSON.stringify({status:'disabled'}),{headers});
  const result=await search(body.query,body.task==='text'?'text':'grounding');
  return new Response(JSON.stringify(result),{headers});
 } catch { return new Response(JSON.stringify({status:'unavailable'}),{headers}); }
});
