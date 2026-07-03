export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;

    // /rooms/slug → room.html?slug=slug
    if (path.startsWith('/rooms/') && path.length > 7) {
      const slug = path.replace('/rooms/', '');
      url.pathname = '/room.html';
      url.searchParams.set('slug', slug);
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }

    // /room or /room/ → room.html
    if (path === '/room' || path === '/room/') {
      url.pathname = '/room.html';
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }

    // www redirect
    if (url.hostname === 'sukoonhomesksa.com') {
      url.hostname = 'www.sukoonhomesksa.com';
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  }
};
