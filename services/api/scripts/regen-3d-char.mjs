const API='http://127.0.0.1:8787/api/v1';
const c = await fetch(API+'/characters/35').then(r=>r.json());
for (const ref of (c.ref_images||[])) { await fetch(API+'/characters/35/ref-images/'+ref.id,{method:'DELETE'}); }
const res = await fetch(API+'/characters/35/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modes:['portrait'],count:1,style:'cgi_3d'})});
const data = await res.json();
console.log('assets', (data.assets||[]).length);
process.exit(0);
