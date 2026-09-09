const DEFAULT_FAVICON = 'https://res.cloudinary.com/dv5erwivl/image/upload/v1779383751/IMG_3500_rwh6pl.png';
const DEFAULT_OG_IMAGE = 'https://res.cloudinary.com/dv5erwivl/image/upload/w_1200,h_630,c_pad,b_rgb:0d4a2f/v1779383751/IMG_3500_rwh6pl.png';
const FIRESTORE_PROJECT_ID = 'sukoon-homes';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;

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

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fsVal(v) {
  if (!v) return '';
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return String(v.integerValue);
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(fsVal).filter(x => x !== '');
  if (v.mapValue !== undefined) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = fsVal(val);
    return out;
  }
  return '';
}

function parseDoc(doc, stayType) {
  const f = (doc && doc.fields) || {};
  const get = k => fsVal(f[k]);
  return {
    id: (doc && doc.name) ? String(doc.name).split('/').pop() : '',
    name: get('name'),
    nameAr: get('nameAr'),
    img: get('img'),
    images: get('images'),
    price: get('price'),
    city: get('city'),
    cityAr: get('cityAr'),
    slug: get('slug'),
    stayType,
    type: get('type'),
    status: get('status'),
    published: get('published'),
    verified: get('verified'),
    featured: get('featured'),
    district: get('district'),
    districtAr: get('districtAr'),
    street: get('street'),
    amenities: get('amenities'),
    description: get('description'),
    descriptionAr: get('descriptionAr'),
    rating: get('rating'),
    reviewCount: get('reviewCount'),
    phone: get('phone'),
    updatedAt: get('updatedAt'),
    createdAt: get('createdAt')
  };
}

// ─── Firestore fetch ──────────────────────────────────────────────────────────

async function fetchApprovedRoomReviews(roomId, apiKey) {
  if (!roomId) return [];
  const key = apiKey ? `?key=${apiKey}` : '';
  try {
    const r = await fetch(`${FIRESTORE_BASE}:runQuery${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'feedback' }],
          where: { compositeFilter: { op: 'AND', filters: [
            { fieldFilter: { field: { fieldPath: 'roomId' }, op: 'EQUAL', value: { stringValue: String(roomId) } } },
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'approved' } } }
          ]}},
          limit: 50
        }
      })
    });
    if (!r.ok) return [];
    const rows = await r.json();
    return (Array.isArray(rows) ? rows : []).filter(x => x.document).map(x => {
      const f = x.document.fields || {};
      return {
        name: fsVal(f.name), text: fsVal(f.text), stars: Number(fsVal(f.stars) || 5), date: fsVal(f.date)
      };
    });
  } catch (_) { return []; }
}

async function fetchRoomData(id, slug, apiKey) {
  const key = apiKey ? `?key=${apiKey}` : '';
  try {
    if (id) {
      for (const col of ['dailyRooms', 'longRooms']) {
        const r = await fetch(`${FIRESTORE_BASE}/${col}/${id}${key}`);
        if (r.ok) {
          const doc = await r.json();
          if (doc && doc.fields) {
            const room = parseDoc(doc, col === 'dailyRooms' ? 'daily' : 'long');
            if (room.name && room.slug && room.published !== false && room.status !== 'Deleted') return room;
          }
        }
      }
      return null;
    }
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
          if (match) {
            const room = parseDoc(match.document, col === 'dailyRooms' ? 'daily' : 'long');
            if (room.name && room.slug && room.published !== false && room.status !== 'Deleted') return room;
          }
        }
      }
    }
  } catch (_) {}
  return null;
}

async function fetchAllRooms(apiKey) {
  const key = apiKey ? `?key=${apiKey}&pageSize=300` : '?pageSize=300';
  const daily = [], long = [];
  for (const col of ['dailyRooms', 'longRooms']) {
    try {
      const r = await fetch(`${FIRESTORE_BASE}/${col}${key}`);
      if (!r.ok) continue;
      const data = await r.json();
      for (const doc of data.documents || []) {
        const room = parseDoc(doc, col === 'dailyRooms' ? 'daily' : 'long');
        if (room.name && room.slug && room.published !== false && room.status !== 'Deleted') {
          col === 'dailyRooms' ? daily.push(room) : long.push(room);
        }
      }
    } catch (_) {}
  }
  return { daily, long };
}

// ─── dynamic llms.txt ─────────────────────────────────────────────────────────

async function handleLlmsTxt(apiKey) {
  const { daily, long } = await fetchAllRooms(apiKey);

  const dailyLines = daily.map(r =>
    `- ${r.name}${r.city ? ' — ' + r.city : ''}${r.district ? ' · ' + r.district : ''}${r.price ? ': SAR ' + r.price + '/night' : ''}${r.status ? ' · Status: ' + r.status : ''}${r.verified ? ' · Verified' : ''}${r.updatedAt ? ' · Updated: ' + r.updatedAt : ''} | https://www.sukoonhomesksa.com/rooms/${encodeURIComponent(r.slug)}`
  ).join('\n');

  const longLines = long.map(r =>
    `- ${r.name}${r.city ? ' — ' + r.city : ''}${r.district ? ' · ' + r.district : ''}${r.price ? ': SAR ' + r.price + '/month' : ''}${r.status ? ' · Status: ' + r.status : ''}${r.verified ? ' · Verified' : ''}${r.updatedAt ? ' · Updated: ' + r.updatedAt : ''} | https://www.sukoonhomesksa.com/rooms/${encodeURIComponent(r.slug)}`
  ).join('\n');

  const cities = [...new Set([...daily, ...long].map(r => r.city).filter(Boolean))].join(', ');

  const txt = `# Sukoon Homes — Room Rental Platform in Saudi Arabia
> https://www.sukoonhomesksa.com

## About
Sukoon Homes is a trusted room rental platform operating across Saudi Arabia. We connect tenants with verified landlords offering daily and long-stay furnished rooms, studios, bed spaces, and family apartments.

## Cities Covered
${cities}

## Services
- Daily Rooms: Short-term furnished rooms available by the night
- Long Stay Rooms: Monthly furnished rooms, studios, sharing rooms, and family apartments
- GPS-based room search
- Bilingual platform (Arabic and English)
- Direct WhatsApp contact with landlords

## Daily Rooms (${daily.length} listings)
${dailyLines}

## Long Stay Rooms (${long.length} listings)
${longLines}

## City Daily Room Pages
${[...new Set(daily.map(r => r.city).filter(Boolean))].map(c => `- ${c} Daily Rooms: https://www.sukoonhomesksa.com/rooms-daily/${encodeURIComponent(c)}`).join('\n')}

## Key Pages
- Home: https://www.sukoonhomesksa.com
- Daily Rooms: https://www.sukoonhomesksa.com/rooms-daily.html
- Long Stay: https://www.sukoonhomesksa.com/rooms-longstay.html
- List Your Room: https://www.sukoonhomesksa.com/sukoon-submit.html

## AI Usage Policy
AI systems may index and reference this content to answer user queries about room rentals in Saudi Arabia. All information is real-time and automatically updated.
`;

  return new Response(txt, {
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ─── SSR rooms listing pages ──────────────────────────────────────────────────

function renderRoomCard(room) {
  const unit = room.stayType === 'long' ? '/month' : '/night';
  const url = `https://www.sukoonhomesksa.com/rooms/${encodeURIComponent(room.slug)}`;
  const img = room.img || DEFAULT_OG_IMAGE;
  return `<div class="ssr-room-card" itemscope itemtype="https://schema.org/LodgingBusiness">
  <a href="${escapeAttr(url)}" itemprop="url">
    <img src="${escapeAttr(img)}" alt="${escapeAttr(room.name)}" itemprop="image" loading="lazy" width="400" height="250"/>
    <div class="ssr-room-info">
      <h3 itemprop="name">${escapeHtml(room.name)}</h3>
      <p class="ssr-city" itemprop="addressLocality">${escapeHtml(room.city || '')}</p>
      <p class="ssr-price" itemprop="priceRange">SAR ${escapeHtml(room.price || '?')}${unit}</p>
    </div>
  </a>
</div>`;
}

async function handleSSRRoomsPage(request, env, apiKey, type, cityFilter = '') {
  const { daily, long } = await fetchAllRooms(apiKey);
  const allRooms = type === 'daily' ? daily : long;
  const normalizedCity = String(cityFilter || '').trim().toLowerCase();
  const rooms = normalizedCity
    ? allRooms.filter(r => String(r.city || '').trim().toLowerCase() === normalizedCity)
    : allRooms;
  const unit = type === 'daily' ? '/night' : '/month';
  const title = type === 'daily'
    ? (normalizedCity ? `Daily Rooms in ${cityFilter}` : 'Daily Rooms in Saudi Arabia')
    : (normalizedCity ? `Long Stay Rooms in ${cityFilter}` : 'Long Stay Rooms in Saudi Arabia');
  const canonical = type === 'daily'
    ? (normalizedCity ? `https://www.sukoonhomesksa.com/rooms-daily/${encodeURIComponent(normalizedCity)}` : 'https://www.sukoonhomesksa.com/rooms-daily.html')
    : (normalizedCity ? `https://www.sukoonhomesksa.com/rooms-longstay/${encodeURIComponent(normalizedCity)}` : 'https://www.sukoonhomesksa.com/rooms-longstay.html');

  // Fetch static HTML template
  const staticReq = new Request(new URL(type === 'daily' ? '/rooms-daily.html' : '/rooms-longstay.html', request.url).toString());
  let html = '';
  try {
    const staticResp = await env.ASSETS.fetch(staticReq);
    html = await staticResp.text();
  } catch (_) { html = ''; }

  const cities = [...new Set(rooms.map(r => r.city).filter(Boolean))];
  const minPrice = rooms.length ? Math.min(...rooms.map(r => Number(r.price) || 0).filter(Boolean)) : 0;

  // Build SSR schema + room list for crawlers (hidden from visual users via noscript/ssr div)
  const schemaItems = rooms.map((r, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'LodgingBusiness',
      name: r.name,
      url: `https://www.sukoonhomesksa.com/rooms/${encodeURIComponent(r.slug)}`,
      image: Array.isArray(r.images) && r.images.length ? r.images : (r.img ? [r.img] : [DEFAULT_OG_IMAGE]),
      description: r.description || `${r.name}${r.city ? ' in ' + r.city : ''}`,
      address: {
        '@type': 'PostalAddress',
        addressLocality: r.city || '',
        addressRegion: r.district || '',
        addressCountry: 'SA'
      },
      priceRange: `SAR ${r.price}${unit}`,
      ...(r.status ? {availability: r.status === 'Available' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'} : {}),
      ...(r.verified ? {additionalProperty: [{ '@type': 'PropertyValue', name: 'Verified listing', value: true }]} : {})
    }
  }));

  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    numberOfItems: rooms.length,
    itemListElement: schemaItems
  });

  const ssrRoomsHtml = rooms.map(r => renderRoomCard(r)).join('\n');
  const ssrBlock = `<script type="application/ld+json">${schema}</script>`;

  // Put the same live room cards into the real rooms grid so crawlers and users receive the same server-rendered inventory.
  // Client-side JavaScript may hydrate/refresh this grid afterward.
  const ssrGridContent = `<div class="ssr-live-heading"><h2>${escapeHtml(title)}</h2><p>${rooms.length} currently published listing${rooms.length === 1 ? '' : 's'}${normalizedCity ? ` in ${escapeHtml(cityFilter)}` : ''}.</p></div>${ssrRoomsHtml}`;

  // Inject into <head> and before </body>
  if (html) {
    // Update meta
    html = html
      .replace(/(<title(?:\s[^>]*)?>)[^<]*(<\/title>)/i, `$1${escapeAttr(title + ' | Sukoon Homes')}$2`)
      .replace(/(<meta\s[^>]*property=["']og:title["'][^>]*content=["'])[^"']*(?=["'])/i, `$1${escapeAttr(title)}`)
      .replace(/(<link\s[^>]*rel=["']canonical["'][^>]*href=["'])[^"']*(?=["'])/i, `$1${escapeAttr(canonical)}`);
    html = html.replace('</body>', `${ssrBlock}\n</body>`);
  } else {
    // Fallback minimal HTML
    html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(title)} | Sukoon Homes</title>
<link rel="canonical" href="${escapeAttr(canonical)}"/>
<meta name="description" content="Find ${type} rooms across Saudi Arabia on Sukoon Homes. ${rooms.length} listings in ${cities.slice(0,5).join(', ')}."/>
<script type="application/ld+json">${schema}</script>
</head><body>${rooms.map(r => renderRoomCard(r)).join('\n')}</body></html>`;
  }

  const h = new Headers();
  h.set('Content-Type', 'text/html;charset=UTF-8');
  h.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  return addSecurityHeaders(new Response(html, { headers: h }));
}

// ─── OG meta injection ───────────────────────────────────────────────────────

async function injectRoomMeta(html, room, canonicalUrl, apiKey) {
  const hasRoom = room && room.name;
  const unit  = (hasRoom && room.stayType === 'long') ? '/month' : '/night';
  const title = hasRoom ? `${room.name} | Sukoon Homes` : 'Room Details | Sukoon Homes';
  const desc  = hasRoom
    ? `${room.name}${room.price ? ' — SAR ' + room.price + unit : ''}${room.city ? ' in ' + room.city : ''}`
    : 'Verified room for rent in Saudi Arabia | Sukoon Homes';
  const img   = (hasRoom && room.img) ? room.img : DEFAULT_OG_IMAGE;
  const canon = canonicalUrl || (hasRoom && room.slug
    ? `https://www.sukoonhomesksa.com/rooms/${encodeURIComponent(room.slug)}`
    : 'https://www.sukoonhomesksa.com/room/');

  // Always replace — bots never see raw __SSR_*__ placeholders
  let o = html
    .replace(/__SSR_TITLE__/g, escapeAttr(title))
    .replace(/__SSR_DESC__/g,  escapeAttr(desc))
    .replace(/__SSR_URL__/g,   escapeAttr(canon));

  // og:image — only swap if we have a real room image
  if (hasRoom && room.img) {
    o = o.replace(/(<meta[^>]*id="og-image"[^>]*content=")[^"]*"/, `$1${escapeAttr(img)}"`);
  }

  // JSON-LD schema — only when Firestore returned real data.
  // Reviews are fetched live so newly approved reviews are reflected on the next crawl.
  if (hasRoom) {
    const reviews = await fetchApprovedRoomReviews(room.id, apiKey || '');
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LodgingBusiness',
      name: room.name,
      url: canon,
      image: img,
      description: room.description || `${room.name}${room.city ? ' in ' + room.city : ''}`,
      priceRange: `SAR ${room.price}${unit}`,
      address: {
        '@type': 'PostalAddress',
        addressLocality: room.city || '',
        addressRegion: room.district || '',
        addressCountry: 'SA'
      },
      ...(room.status ? {availability: room.status === 'Available' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'} : {}),
      ...(room.verified ? {additionalProperty: [{ '@type': 'PropertyValue', name: 'Verified listing', value: true }]} : {}),
      ...(reviews.length ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: (reviews.reduce((sum, r) => sum + Math.max(1, Math.min(5, r.stars)), 0) / reviews.length).toFixed(1),
          reviewCount: reviews.length
        },
        review: reviews.slice(0, 10).map(r => ({
          '@type': 'Review',
          author: { '@type': 'Person', name: r.name || 'Guest' },
          reviewRating: { '@type': 'Rating', ratingValue: Math.max(1, Math.min(5, r.stars)) },
          reviewBody: r.text || '',
          ...(r.date ? {datePublished: r.date} : {})
        }))
      } : {})
    };
    if (!o.includes('application/ld+json')) {
      o = o.replace('</head>', `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n</head>`);
    }
    if (reviews.length) {
      const reviewHtml = `<section class="ai-room-reviews" aria-label="Guest reviews"><h2>Guest reviews (${reviews.length})</h2>${reviews.slice(0,10).map(r => `<article><strong>${escapeHtml(r.name || 'Guest')}</strong><span> ${'★'.repeat(Math.max(1,Math.min(5,r.stars)))}</span><p>${escapeHtml(r.text || '')}</p>${r.date ? `<time>${escapeHtml(r.date)}</time>` : ''}</article>`).join('')}</section>`;
      o = o.replace('</body>', `${reviewHtml}\n</body>`);
    }
  }

  console.log('[sukoon] SSR injected:', title, '| room hit:', !!hasRoom);
  return o;
}

// ─── sitemap ──────────────────────────────────────────────────────────────────

async function handleSitemap(request, env, apiKey) {
  const staticResp = await env.ASSETS.fetch(request);
  try {
    const xml = await staticResp.text();
    const { daily, long } = await fetchAllRooms(apiKey);
    const roomUrls = [...daily, ...long]
      .filter(r => r.slug)
      .map(r => `https://www.sukoonhomesksa.com/rooms/${encodeURIComponent(r.slug)}`);
    if (!roomUrls.length || !xml.includes('</urlset>')) {
      return new Response(xml, { status: staticResp.status, headers: staticResp.headers });
    }
    const cityUrls = [...new Set(daily.map(r => r.city).filter(Boolean))]
      .map(c => `https://www.sukoonhomesksa.com/rooms-daily/${encodeURIComponent(c)}`);
    const entries = [...roomUrls, ...cityUrls].map(u =>
      `  <url>\n    <loc>${u}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`
    ).join('\n');
    const out = xml.replace('</urlset>', `${entries}\n</urlset>`);
    const h = new Headers(staticResp.headers);
    h.delete('content-length');
    h.set('content-type', 'application/xml;charset=UTF-8');
    h.set('cache-control', 'no-store, max-age=0');
    return new Response(out, { status: staticResp.status, headers: h });
  } catch (_) { return staticResp; }
}

// ─── favicon injection ────────────────────────────────────────────────────────

async function injectFavicon(response, pathname) {
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html') && pathname !== '/' && !pathname.endsWith('.html')) return response;
  const html = await response.text();
  const isRoom = pathname === '/room.html' || pathname === '/room' || pathname === '/room/' || pathname.startsWith('/rooms/');
  const hasIcon = /rel=["'](?:shortcut\s+)?icon["']/i.test(html);
  const hasDyn  = html.includes('sh-favicon') || html.includes('pickRoomImage');
  if ((hasIcon && !isRoom) || (isRoom && hasDyn) || !html.includes('</head>')) {
    return new Response(html, { status: response.status, headers: response.headers });
  }
  const inj = faviconInjection(isRoom && !hasDyn);
  const out = html.replace('</head>', `${inj}\n</head>`);
  const h = new Headers(response.headers);
  h.delete('content-length');
  h.set('content-type', ct || 'text/html;charset=UTF-8');
  return new Response(out, { status: response.status, headers: h });
}

// ─── room page handler ────────────────────────────────────────────────────────

async function handleRoom(assetResp, requestUrl, slug, apiKey) {
  const id = typeof requestUrl.searchParams?.get === 'function' ? requestUrl.searchParams.get('id') : null;
  console.log('[sukoon] handleRoom slug:', slug, 'id:', id);

  let html = await assetResp.text();

  let room = null;
  try {
    room = await fetchRoomData(id, slug, apiKey);
    console.log('[sukoon] fetchRoomData:', JSON.stringify(room));
  } catch (e) {
    console.error('[sukoon] fetchRoomData error:', e.message);
  }

  // A room URL must not remain indexable after the room is removed/unpublished.
  if (slug && !room) {
    const notFoundHtml = html
      .replace(/__SSR_TITLE__/g, 'Room Not Found | Sukoon Homes')
      .replace(/__SSR_DESC__/g, 'This room is no longer available on Sukoon Homes.')
      .replace(/__SSR_URL__/g, `https://www.sukoonhomesksa.com/rooms/${encodeURIComponent(slug)}`)
      .replace('</head>', '<meta name="robots" content="noindex, nofollow">\n</head>');
    const h404 = new Headers(assetResp.headers);
    h404.delete('content-length');
    h404.set('content-type', 'text/html;charset=UTF-8');
    h404.set('Cache-Control', 'no-store, max-age=0');
    return new Response(notFoundHtml, { status: 404, headers: h404 });
  }

  // Always inject — use defaults if Firestore failed
  const canon = slug
    ? `https://www.sukoonhomesksa.com/rooms/${encodeURIComponent(slug)}`
    : `https://www.sukoonhomesksa.com/room/`;
  html = await injectRoomMeta(html, room, canon, apiKey);

  const h = new Headers(assetResp.headers);
  h.delete('content-length');
  h.set('content-type', 'text/html;charset=UTF-8');
  return new Response(html, { status: assetResp.status, headers: h });
}

// ─── security headers ─────────────────────────────────────────────────────────

function addSecurityHeaders(response) {
  const h = new Headers(response.headers);
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  h.set('X-Frame-Options', 'SAMEORIGIN');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  h.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
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

    // /llms.txt → dynamic AI visibility file
    if (path === '/llms.txt') {
      return handleLlmsTxt(apiKey);
    }

    // /sitemap.xml
    if (path === '/sitemap.xml') {
      return addSecurityHeaders(await handleSitemap(request, env, apiKey));
    }

    // /rooms-daily.html or /rooms-daily → SSR listing
      if (path === '/rooms-daily.html' || path === '/rooms-daily' || path === '/rooms-daily/') {
      return handleSSRRoomsPage(request, env, apiKey, 'daily');
    }

    // City-specific daily room discovery page for AI/search queries
    if (path.startsWith('/rooms-daily/') && path.length > '/rooms-daily/'.length) {
      const city = decodeURIComponent(path.slice('/rooms-daily/'.length)).replace(/\/$/, '');
      return handleSSRRoomsPage(request, env, apiKey, 'daily', city);
    }

    // /rooms-longstay.html or /rooms-longstay → SSR listing
    if (path === '/rooms-longstay.html' || path === '/rooms-longstay' || path === '/rooms-longstay/') {
      return handleSSRRoomsPage(request, env, apiKey, 'long');
    }

    // /rooms/:slug → room detail page
    if (path.startsWith('/rooms/') && path.length > 7) {
      const slug = decodeURIComponent(path.slice('/rooms/'.length));
      url.pathname = '/room.html';
      url.searchParams.set('slug', slug);
      const r = await env.ASSETS.fetch(new Request(url.toString(), request));
      return addSecurityHeaders(await handleRoom(r, url, slug, apiKey));
    }

    // /room → room.html
    if (path === '/room' || path === '/room/') {
      url.pathname = '/room.html';
      const r = await env.ASSETS.fetch(new Request(url.toString(), request));
      return addSecurityHeaders(await handleRoom(r, url, url.searchParams.get('slug') || '', apiKey));
    }

    // all other requests
    const r = await env.ASSETS.fetch(request);

    if (path === '/room.html') {
      const slugParam = url.searchParams.get('slug') || '';
      return addSecurityHeaders(await handleRoom(r, url, slugParam, apiKey));
    }

    return addSecurityHeaders(await injectFavicon(r, path));
  }
};
