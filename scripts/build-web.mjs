import{execFileSync}from'node:child_process';import{build}from'esbuild';
execFileSync(process.execPath,['scripts/compile-contracts.mjs'],{stdio:'inherit'});
await build({entryPoints:['client/live.js'],outfile:'web/live.bundle.js',bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',legalComments:'eof'});
await build({entryPoints:['client/diagnostics.js'],outfile:'web/diagnostics.bundle.js',bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',legalComments:'eof'});
