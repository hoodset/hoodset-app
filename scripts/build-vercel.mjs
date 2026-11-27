import fs from'node:fs';import{execFileSync}from'node:child_process';
execFileSync(process.execPath,['scripts/build-web.mjs'],{stdio:'inherit'});
fs.rmSync('dist/vercel-static',{recursive:true,force:true});fs.mkdirSync('dist/vercel-static',{recursive:true});
fs.cpSync('web','dist/vercel-static',{recursive:true});
// The retired browser-only sandbox is retained as test source, not a public product route.
for(const file of ['paper.html','app.js','engine.js'])fs.rmSync('dist/vercel-static/'+file,{force:true});
// The root is server rendered so canonical and social metadata use the domain.
fs.rmSync('dist/vercel-static/index.html');
console.log('HOODSET Vercel static assets and wallet bundles ready.');
