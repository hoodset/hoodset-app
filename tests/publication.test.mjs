import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pageMetadata,publicationFile} from '../worker/publication.js';

test('sharing metadata follows the actual domain and ignores a forwarded host',()=>{
  const source=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  for(const origin of ['https://hoodset.example','http://127.0.0.1:4317']){
    const page=pageMetadata(source,new Request(origin+'/',{headers:{'X-Forwarded-Host':'untrusted.example'}}));
    assert.ok(page.includes(`rel="canonical" href="${origin}/"`));
    assert.ok(page.includes(`property="og:image" content="${origin}/assets/social-cover.png"`));
    assert.ok(page.includes('name="twitter:site" content="@hoodsetq"'));
    assert.ok(!page.includes('__HOODSET_ORIGIN__')&&!page.includes('untrusted.example'));
    assert.ok(!page.includes('elyset-rh-demo-1126'));
  }
});

test('crawler files identify the same origin without indexing API payloads or inventing route pages',async()=>{
  const origin='https://hoodset.example';
  const robots=publicationFile(new Request(origin+'/robots.txt'));
  assert.equal(robots.status,200);
  assert.match(await robots.text(),/Disallow: \/api\//);
  const sitemap=publicationFile(new Request(origin+'/sitemap.xml'));
  assert.equal(await sitemap.text(),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`);
  assert.equal(await publicationFile(new Request(origin+'/robots.txt',{method:'HEAD'})).text(),'');
  assert.equal(publicationFile(new Request(origin+'/robots.txt',{method:'POST'})),null);
  assert.equal(publicationFile(new Request(origin+'/api/history')),null);
});
