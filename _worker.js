const DEFAULT_FAVICON = 'https://res.cloudinary.com/dv5erwivl/image/upload/v1779383751/IMG_3500_rwh6pl.png';
const DEFAULT_OG_IMAGE = 'https://www.sukoonhomesksa.com/og-image.jpg';
const FIRESTORE_PROJECT_ID = 'sukoon-homes';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;

function faviconInjection(isRoomPage) {
  const links = `<link id="sh-favicon" rel="icon" type="image/png" href="${DEFAULT_FAVICON}"/>
<link id="sh-apple-touch-icon" rel="apple-touch-icon" href="${DEFAULT_FAVICON}"/>`;

  if (!isRoomPage) return links;

  return `${links}
<script>
(function(){
  var fallback = '${DEFAULT_FAVICON}';
  function ensureLink(id, rel){
    var el = document.getElementById(id);
    if(!el){
      el = document.createElement('link');
      el.id = id;
      el.rel = rel;
      document.head.appendChild(el);
    }
    return el;
  }
  function setFavicon(url){
    if(!url || !/^https?:\/\//i.test(url)) url = fallback;
    var icon = ensureLink('sh-favicon','icon');
    icon.type = 'image/png';
    icon.href = url;
    ensureLink('sh-apple-touch-icon','apple-touch-icon').href = url;
  }
  function pickRoomImage(){
    var main = document.getElementById('main-img') || document.querySelector('.gallery-main img');
    var og = document.querySelector('meta[property="og:image"]');
    setFavicon((main && main.src) || (og && og.content) || fallback);
  }
  document.addEventListener('DOMContentLoaded', pickRoomImage);
  window.addEventListener('load', pickRoomImage);
  if(window.MutationObserver){
    new MutationObserver(pickRoomImage).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src','content']
    });
  }
  var tries = 0;
  var timer = setInterval(function(){
    pickRoomImage();
    if(++tries > 20) clearInterval(timer);
  }, 500);
})();
<\/script>`;
}

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseFirestoreDoc(doc, stayType) {
  const f = (doc && doc.fields) || {};
  const get = (k) => {
    const v = f[k];
    if (!v) return '';
    return v.stringValue ?? v.integerValue ?? v.doubleValue ?? '';
  };
  return {
    name: get('name'),
    img: get('img'),
    price: get('price'),
    city: get('city'),
    stayType
  };
}

async function fetchRoomData(id, slug) {
  try {
    if (id) {
      for (const col of ['dailyRooms', 'longRooms']) {
        const res = await fetch(`${FIRESTORE_BASE}/${col}/${id}`);
        if (res.ok) {
          const doc = await res.json();
          if (doc && doc.fields) return parseFirestoreDoc(doc, col === 'dailyRooms' ? 'daily' : 'long');
        }
      }
      return null;
    }

    if (slug) {
      for (const col of ['dailyRooms', 'longRooms']) {
        const body = {
          structuredQuery: {
            from: [{ collectionId: col }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'slug' },
                op: 'EQUAL',
                value: { stringValue: slug }
              }
            },
            limit: 1
          }
        };
        const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          const results = await res.json();
          const match = Array.isArray(results) ? results.find((r) => r.document) : null;
          if (match) return parseFirestoreDoc(match.document, col === 'dailyRooms' ? 'daily' : 'long');
        }
      }
    }
  } catch (e) {
    // Firestore lookup failed; fall back to default meta tags
  }
  return null;
}

function injectRoomMeta(html, room) {
  if (!room || !room.name) return html;

  const priceUnit = room.stayType === 'long' ? '/month' : '/night';
  const priceText = room.price ? ` - SAR ${room.price}${priceUnit}` : '';
  const title = `${room.name} | Sukoon Homes`;
  const desc = `${room.name}${priceText}${room.city ? ' - ' + room.city : ''}`;
  const image = room.img || DEFAULT_OG_IMAGE;

  let out = html;
  out = out.replace(/(<title id="page-title">)[^<]*(<\/title>)/, `$1${escapeAttr(title)}$2`);
  out = out.replace(/(<meta name="description" id="page-desc" content=")[^"]*(")/, `$1${escapeAttr(desc)}$2`);
  out = out.replace(/(<meta property="og:title" id="og-title" content=")[^"]*(")/, `$1${escapeAttr(title)}$2`);
  out = out.replace(/(<meta property="og:description" id="og-desc" content=")[^"]*(")/, `$1${escapeAttr(desc)}$2`);
  out = out.replace(/(<meta property="og:image" id="og-image" content=")[^"]*(")/, `$1${escapeAttr(image)}$2`);
  return out;
}

async function maybeInjectFavicon(response, pathname) {
  const type = response.headers.get('content-type') || '';
  const isHtmlPath = pathname === '/' || pathname.endsWith('.html');
  if (!type.includes('text/html') && !isHtmlPath) return response;

  const html = await response.text();
  const isRoomPage = pathname === '/room.html' || pathname === '/room' || pathname === '/room/' || pathname.startsWith('/rooms/');
  const hasIcon = /rel=["'](?:shortcut\s+)?icon["']/i.test(html);
  const hasDynamicRoomIcon = html.includes('sh-favicon') || html.includes('pickRoomImage');

  if ((hasIcon && !isRoomPage) || (isRoomPage && hasDynamicRoomIcon) || !html.includes('</head>')) {
    return new Response(html, response);
  }

  const injection = faviconInjection(isRoomPage && !hasDynamicRoomIcon);
  const nextHtml = html.replace('</head>', `${injection}\n</head>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', type || 'text/html; charset=UTF-8');

  return new Response(nextHtml, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function handleRoomResponse(response, requestUrl, faviconPath) {
  let resp = response;

  if (requestUrl.pathname === '/room.html') {
    const slug = requestUrl.searchParams.get('slug');
    const id = requestUrl.searchParams.get('id');

    if (slug || id) {
      let dbg = 'room-debug: not-run';
      let htmlToUse = null;
      try {
        const room = await fetchRoomData(id, slug);
        if (room) {
          dbg = `room-debug: found name="${room.name}" img="${room.img}"`;
          const html = await resp.text();
          htmlToUse = injectRoomMeta(html, room);
        } else {
          dbg = `room-debug: not-found slug=${slug || ''} id=${id || ''}`;
          htmlToUse = await resp.text();
        }
      } catch (e) {
        dbg = 'room-debug: error ' + (e && e.message ? e.message : String(e));
        try { htmlToUse = await resp.text(); } catch (e2) { htmlToUse = null; }
      }
      if (htmlToUse !== null) {
        const withDebug = htmlToUse.includes('</head>') ? htmlToUse.replace('</head>', `<!-- ${dbg} -->\n</head>`) : htmlToUse;
        const headers = new Headers(resp.headers);
        headers.delete('content-length');
        resp = new Response(withDebug, { status: resp.status, statusText: resp.statusText, headers });
      }
    }
  }

  return maybeInjectFavicon(resp, faviconPath);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;

    // /rooms/slug -> room.html?slug=slug
    if (path.startsWith('/rooms/') && path.length > 7) {
      const slug = path.replace('/rooms/', '');
      url.pathname = '/room.html';
      url.searchParams.set('slug', slug);
      const response = await env.ASSETS.fetch(new Request(url.toString(), request));
      return handleRoomResponse(response, url, '/rooms/' + slug);
    }

    // /room or /room/ -> room.html
    if (path === '/room' || path === '/room/') {
      url.pathname = '/room.html';
      const response = await env.ASSETS.fetch(new Request(url.toString(), request));
      return handleRoomResponse(response, url, path);
    }

    // www redirect
    if (url.hostname === 'sukoonhomesksa.com') {
      url.hostname = 'www.sukoonhomesksa.com';
      return Response.redirect(url.toString(), 301);
    }

    const response = await env.ASSETS.fetch(request);

    if (path === '/room.html') {
      return handleRoomResponse(response, url, path);
    }

    return maybeInjectFavicon(response, path);
  }
};
