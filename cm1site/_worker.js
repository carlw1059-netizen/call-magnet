export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    url.pathname = '/b';
    return env.ASSETS.fetch(url);
  }
}
