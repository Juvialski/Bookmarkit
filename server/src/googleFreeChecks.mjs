const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export function createGoogleFreeChecks({ serviceAccount, accessToken, fetcher = fetch } = {}) {
  let cached;
  async function token() {
    if (accessToken) return accessToken;
    if (!serviceAccount) return null;
    if (cached && cached.expires > Date.now()) return cached.token;
    const account = JSON.parse(serviceAccount);
    if (!account.client_email || !account.private_key) return null;
    const now = Math.floor(Date.now()/1000), encode = value => b64(new TextEncoder().encode(JSON.stringify(value)));
    const unsigned = encode({ alg:'RS256',typ:'JWT' })+'.'+encode({ iss:account.client_email,scope:'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/cloud-billing.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600 });
    const der=Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g,'')), c=>c.charCodeAt(0));
    const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
    const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+b64(signature)}),signal:AbortSignal.timeout(3000)});
    if(!response.ok)return null;
    const data=await response.json(); cached={token:data.access_token,expires:Date.now()+Math.min(data.expires_in||0,3300)*1000};return cached.token;
  }
  async function authorized(url) { const value=await token(); if(!value)return null; const response=await fetcher(url,{headers:{Authorization:`Bearer ${value}`},signal:AbortSignal.timeout(3000)});return response.ok?response.json():null; }
  return {
    billingCheck: async (id,number) => { try {
      // Bind the billing lookup ID to the same numeric project as the API key.
      const project=await authorized(`https://cloudresourcemanager.googleapis.com/v3/projects/${id}`);
      if(project?.projectId!==id || project?.name!==`projects/${number}`)return false;
      const result=await authorized(`https://cloudbilling.googleapis.com/v1/projects/${id}/billingInfo`);
      return result?.projectId===id && result?.billingEnabled===false && !result?.billingAccountName;
    } catch{return false;} },
    keyProjectCheck: async (key,number) => { try { const result=await authorized(`https://apikeys.googleapis.com/v2/keys:lookupKey?keyString=${encodeURIComponent(key)}`);return result?.parent===`projects/${number}/locations/global`; }catch{return false;} },
    modelCheck: async (key,model) => { try { const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}`,{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(2000)});if(!response.ok)return false;return (await response.json()).supportedGenerationMethods?.includes('generateContent')===true; }catch{return false;} }
  };
}
