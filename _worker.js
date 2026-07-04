const DEFAULT_FAVICON = 'https://res.cloudinary.com/dv5erwivl/image/upload/v1779383751/IMG_3500_rwh6pl.png';
const DEFAULT_OG_IMAGE = 'https://www.sukoonhomesksa.com/og-image.jpg';
const FIRESTORE_PROJECT_ID = 'sukoon-homes';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
// Firestore REST API key — public read key for OG meta lookup only
// Set FIRESTORE_API_KEY in Worker env vars (Cloudflare dashboard → sukoon-homes → Settings → Variables)
// This is a restricted browser API key (read-only, referrer-locked to sukoonhomesksa.com)

// ─── favicon injection ───────────────────────────────────────────────────────

function faviconInjection(isRoomPage) {
  const links = `<link id="sh-favicon" rel="icon" type="image/png" href="${DEFAULT_FAVICON}"/>
<link id="sh-apple-touch-icon" rel="apple-touch-icon" href="${DEFAULT_FAVICON}"/>`;
  if (!isRoomPage) return links;
  return `${links}
<script>
(function(){
  var fallback='${DEFAULT_FAVICON}';
  function ensureLink(id,rel){var el=document.getElementById(id);if(!el){el=document.createElement('link');el.id=id;el.rel=rel;document.head.appendChild(el);}return el;}
  function setFavicon(url){if(!url||!/^https?:\/\//i.test(url))url=fallback;var ic=ensureLink('sh-favicon','icon');ic.type='image/png';ic.href=url;ensureLink('sh-apple-touch-icon','apple-touch-icon').href=url;}
  function pick(){var m=document.getElementById('main-img')||document.querySelector('.gallery-main img');var og=document.querySelector('meta[property="og:image"]');setFavicon((m&&m.src)||(og&&og.content)||fallback);}
  document.addEventListener('DOMContentLoaded',pick);window.addEventListener('load',pick);
  if(window.MutationObserver){new MutationObserver(pick).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','content']});}
  var t=0;var ti=setInterval(function(){pick();if(++t>20)clearInterval(ti);},500);
})();
<\/script>`;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseDoc(doc, stayType) {
  const f = (doc && doc.fields) || {};
  const get = k => { const v = f[k]; if (!v) return ''; return v.stringValue ?? String(v.integerValue ?? v.doubleValue ?? ''); };
  return { name: get('name'), img: get('img'), price: get('price'), city: get('city'), stayType };
}

// ─── Firestore fetch (unauthenticated — requires Firestore rules: allow read) ─

async function fetchRoomData(id, slug, apiKey) {
  const key = apiKey ? `?key=${apiKey}` : '';
  try {
    // Try by document ID first (faster, single request)
    if (id) {
      for (const col of ['dailyRooms', 'longRooms']) {
        const r = await fetch(`${FIRESTORE_BASE}/${col}/${id}${key}`);
        if (r.ok) {
          const doc = await r.json();
          if (doc && doc.fields) return parseDoc(doc, col === 'dailyRooms' ? 'daily' : 'long');
        }
      }
      return null;
    }
    // Try by slug (runQuery)
    if (slug) {
      for (const col of ['dailyRooms', 'longRooms']) {
        const r = await fetch(`${FIRESTORE_BASE}:runQuery${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: col }],
              where: { fieldFilter: { field: { fieldPath: 'slug' }, op: 'EQUAL', value: { stringValue: slug } } },
              limit: 1
            }
          })
        });
        if (r.ok) {
          const res = await r.json();
          const match = Array.isArray(res) ? res.find(x => x.document) : null;
          if (match) return parseDoc(match.document, col === 'dailyRooms' ? 'daily' : 'long');
        }
      }
    }
  } catch (_) {}
  return null;
}

// ─── OG meta injection ───────────────────────────────────────────────────────

function injectRoomMeta(html, room) {
  if (!room || !room.name) return html;
  const unit  = room.stayType === 'long' ? '/month' : '/night';
  const price = room.price ? ` — SAR ${room.price}${unit}` : '';
  const title = `${room.name} | Sukoon Homes`;
  const desc  = `${room.name}${price}${room.city ? ' — ' + room.city : ''}`;
  const img   = room.img || DEFAULT_OG_IMAGE;
  let o = html;
  o = o.replace(/(<title(?:\s[^>]*)?>)[^<]*(<\/title>)/i,           `$1${escapeAttr(title)}$2`);
  o = o.replace(/(<meta\s[^>]*name=["']description["'][^>]*content=["'])[^"']*(?=["'])/i, `$1${escapeAttr(desc)}`);
  o = o.replace(/(<meta\s[^>]*content=["'])[^"']*(?=["'][^>]*name=["']description["'])/i, `$1${escapeAttr(desc)}`);
  o = o.replace(/(<meta\s[^>]*property=["']og:title["'][^>]*content=["'])[^"']*(?=["'])/i,       `$1${escapeAttr(title)}`);
  o = o.replace(/(<meta\s[^>]*content=["'])[^"']*(?=["'][^>]*property=["']og:title["'])/i,       `$1${escapeAttr(title)}`);
  o = o.replace(/(<meta\s[^>]*property=["']og:description["'][^>]*content=["'])[^"']*(?=["'])/i, `$1${escapeAttr(desc)}`);
  o = o.replace(/(<meta\s[^>]*content=["'])[^"']*(?=["'][^>]*property=["']og:description["'])/i, `$1${escapeAttr(desc)}`);
  o = o.replace(/(<meta\s[^>]*property=["']og:image["'][^>]*content=["'])[^"']*(?=["'])/i,       `$1${escapeAttr(img)}`);
  o = o.replace(/(<meta\s[^>]*content=["'])[^"']*(?=["'][^>]*property=["']og:image["'])/i,       `$1${escapeAttr(img)}`);
  o = o.replace(/(<meta\s[^>]*name=["']twitter:title["'][^>]*content=["'])[^"']*(?=["'])/i,       `$1${escapeAttr(title)}`);
  o = o.replace(/(<meta\s[^>]*name=["']twitter:description["'][^>]*content=["'])/i, `$1${escapeAttr(desc)}`);
  o = o.replace(/(<meta\s[^>]*name=["']twitter:image["'][^>]*content=["'])[^"']*(?=["'])/i,       `$1${escapeAttr(img)}`);
  return o;
}

// ─── favicon injection helper ─────────────────────────────────────────────────

async function injectFavicon(response, pathname) {
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html') && pathname !== '/' && !pathname.endsWith('.html')) return response;
  const html = await response.text();
  const isRoom = pathname === '/room.html' || pathname === '/room' || pathname === '/room/' || pathname.startsWith('/rooms/');
  const hasIcon = /rel=["'](?:shortcut\s+)?icon["']/i.test(html);
  const hasDyn  = html.includes('sh-favicon') || html.includes('pickRoomImage');
  if ((hasIcon && !isRoom) || (isRoom && hasDyn) || !html.includes('</head>')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const inj = faviconInjection(isRoom && !hasDyn);
  const out = html.replace('</head>', `${inj}\n</head>`);
  const h = new Headers(response.headers);
  h.delete('content-length');
  h.set('content-type', ct || 'text/html;charset=UTF-8');
  return new Response(out, { status: response.status, statusText: response.statusText, headers: h });
}

// ─── room response handler ────────────────────────────────────────────────────

async function handleRoom(assetResp, requestUrl, faviconPath, apiKey) {
  let resp = assetResp;
  const slug = requestUrl.searchParams.get('slug');
  const id   = requestUrl.searchParams.get('id');
  if (slug || id) {
    try {
      const room = await fetchRoomData(id, slug, apiKey);
      if (room && room.name) {
        const html    = await resp.text();
        const patched = injectRoomMeta(html, room);
        const h = new Headers(resp.headers);
        h.delete('content-length');
        resp = new Response(patched, { status: resp.status, statusText: resp.statusText, headers: h });
      }
    } catch (_) {}
  }
  return injectFavicon(resp, faviconPath);
}

// ─── main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const apiKey = env.FIRESTORE_API_KEY || '';

    // non-www → www
    if (url.hostname === 'sukoonhomesksa.com') {
      url.hostname = 'www.sukoonhomesksa.com';
      return Response.redirect(url.toString(), 301);
    }

    // /rooms/:slug  →  room.html?slug=:slug
    if (path.startsWith('/rooms/') && path.length > 7) {
      const slug = path.slice('/rooms/'.length);
      url.pathname = '/room.html';
      url.searchParams.set('slug', slug);
      const r = await env.ASSETS.fetch(new Request(url.toString(), request));
      return handleRoom(r, url, path, apiKey);
    }

    // /room  →  room.html
    if (path === '/room' || path === '/room/') {
      url.pathname = '/room.html';
      const r = await env.ASSETS.fetch(new Request(url.toString(), request));
      return handleRoom(r, url, path, apiKey);
    }

    // all other requests
    const r = await env.ASSETS.fetch(request);

    // room.html with ?slug or ?id
    if (path === '/room.html') {
      return handleRoom(r, url, path, apiKey);
    }

    return injectFavicon(r, path);
  }
};
