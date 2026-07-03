const DEFAULT_FAVICON = 'https://res.cloudinary.com/dv5erwivl/image/upload/v1779383751/IMG_3500_rwh6pl.png';

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
      return maybeInjectFavicon(response, '/rooms/' + slug);
    }

    // /room or /room/ -> room.html
    if (path === '/room' || path === '/room/') {
      url.pathname = '/room.html';
      const response = await env.ASSETS.fetch(new Request(url.toString(), request));
      return maybeInjectFavicon(response, path);
    }

    // www redirect
    if (url.hostname === 'sukoonhomesksa.com') {
      url.hostname = 'www.sukoonhomesksa.com';
      return Response.redirect(url.toString(), 301);
    }

    const response = await env.ASSETS.fetch(request);
    return maybeInjectFavicon(response, path);
  }
};