const escapeAttribute = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// The incoming Site host becomes canonical after a custom domain is attached.
// Never pin sharing metadata to the temporary preview or trust forwarded hosts.
export function pageMetadata(html, request) {
  return html.replaceAll('__HOODSET_ORIGIN__', escapeAttribute(new URL(request.url).origin));
}

export function publicationFile(request) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const headers = {'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  if (url.pathname === '/robots.txt') {
    return new Response(request.method === 'HEAD' ? null : `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${url.origin}/sitemap.xml\n`, {headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
  }
  if (url.pathname === '/sitemap.xml') {
    const origin = escapeAttribute(url.origin);
    return new Response(request.method === 'HEAD' ? null : `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`, {headers:{...headers,'Content-Type':'application/xml; charset=utf-8'}});
  }
  return null;
}
