# Contract: _redirects — Project C (cm1.au)

**File location**: `cm1site/_redirects` (new file, does not currently exist)

This file tells Cloudflare Pages how to handle every request to `cm1.au`.

## File Contents

```
/*    /b.html    200
```

## Plain English

Every URL on cm1.au — whether it's `cm1.au/arcane-fairies`, `cm1.au/the-loft`, or any other slug — loads `b.html`. The slug stays in the browser address bar (it's a rewrite, not a redirect). `b.html` reads the slug from `window.location.pathname` to look up the correct client.

This is a 200 rewrite (not a 301 redirect), meaning the URL shown in the browser does not change.
