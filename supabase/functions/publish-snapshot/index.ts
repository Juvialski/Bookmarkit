const snapshot = {"version": "2026-10", "schema": "v3", "works": 25265, "isbns": 26464, "bytes": 31838208, "sha256": "ba7b45949586e03c9be2f747bd297053dfd84b3b464d2142e24b3602592c9b70", "file": "expanded.db", "sources": ["https://openlibrary.org/data/ol_dump_editions_latest.txt.gz", "https://openlibrary.org/data/ol_dump_authors_latest.txt.gz", "https://openlibrary.org/data/ol_dump_ratings_latest.txt.gz"]};
Deno.serve(async req => {
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(req.method!=='POST') return new Response('{}',{status:405,headers});
 // This endpoint can publish exactly one reviewed snapshot, never arbitrary data.
 const input=await req.arrayBuffer();
 if(input.byteLength!==snapshot.bytes) return new Response('{}',{status:400,headers});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==snapshot.sha256) return new Response('{}',{status:400,headers});
 const base=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const auth={apikey:key,Authorization:`Bearer ${key}`};
 const path=`${snapshot.version}/${hash}.db`;
 const upload=await fetch(`${base}/storage/v1/object/book-catalogs/${path}`,{method:'POST',headers:{...auth,'Content-Type':'application/octet-stream'},body:input});
 if(!upload.ok){
  const existing=await fetch(`${base}/storage/v1/object/public/book-catalogs/${path}`);
  if(!existing.ok) return new Response('{}',{status:502,headers});
  const bytes=await existing.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==hash) return new Response('{}',{status:502,headers});
 }
 const record={version:snapshot.version+'-'+hash.slice(0,12),schema_version:snapshot.schema,works:snapshot.works,isbns:snapshot.isbns,bytes:snapshot.bytes,sha256:hash,url:`${base}/storage/v1/object/public/book-catalogs/${path}`};
 const publish=await fetch(`${base}/rest/v1/catalog_manifests`,{method:'POST',headers:{...auth,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify([record])});
 return new Response(JSON.stringify({published:publish.ok}),{status:publish.ok?200:502,headers});
});
