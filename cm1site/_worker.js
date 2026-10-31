export default {
  async fetch(request, env) {
    const bUrl = new URL('/b.html', request.url);
    const response = await fetch(bUrl.toString());
    return new Response(response.body, {
      status: 200,
      headers: response.headers
    });
  }
}
