import fs from'node:fs';import{execFileSync}from'node:child_process';
execFileSync(process.execPath,['scripts/build-web.mjs'],{stdio:'inherit'});
fs.rmSync('dist/vercel-static',{recursive:true,force:true});fs.mkdirSync('dist/vercel-static',{recursive:true});
fs.cpSync('web','dist/vercel-static',{recursive:true});
// The root is server rendered so canonical and social metadata use the domain.
fs.rmSync('dist/vercel-static/index.html');
console.log('HOODSET Vercel static assets and wallet bundles ready.');
