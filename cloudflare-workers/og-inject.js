const SOCIAL_BOTS = ['facebookexternalhit', 'whatsapp', 'twitterbot', 'linkedinbot', 'slackbot', 'telegrambot', 'discordbot', 'ia_archiver'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ua = (request.headers.get('User-Agent') || '').toLowerCase();
    const isBot = SOCIAL_BOTS.some(bot => ua.includes(bot));
    const slug = url.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];

    if (!isBot || !slug) {
      return fetch(request);
    }

    let businessName = 'CallMagnet';
    let ogImage = '';

    try {
      const res = await fetch(
        env.SUPABASE_URL + '/rest/v1/clients?select=business_name,middle_man_logo_url,middle_man_background_poster_url&middle_man_slug=eq.' + slug + '&limit=1',
        {
          headers: {
            'apikey': env.SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY
          }
        }
      );
      const data = await res.json();
      if (data && data[0]) {
        businessName = data[0].business_name || 'CallMagnet';
        ogImage = data[0].middle_man_logo_url || data[0].middle_man_background_poster_url || '';
        if (ogImage) ogImage = ogImage.split('?')[0];
      }
    } catch (e) {}

    const pageRes = await fetch(request);
    const html = await pageRes.text();

    const ogTags = '<meta property="og:title" content="' + businessName + '" />'
      + '<meta property="og:description" content="Tap to connect with ' + businessName + '" />'
      + '<meta property="og:image" content="' + ogImage + '" />'
      + '<meta property="og:url" content="' + url.href + '" />'
      + '<meta property="og:type" content="website" />';

    const injected = html.replace('</head>', ogTags + '</head>');

    return new Response(injected, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store'
      }
    });
  }
};
