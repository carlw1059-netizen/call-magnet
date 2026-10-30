# Contract: _redirects — Project A (callmagnet.com.au)

**File location in cf-marketing branch**: `_redirects`

This file tells Cloudflare Pages how to handle requests to `callmagnet.com.au` that are not the marketing homepage.

## File Contents

```
/b/*    https://cm1.au/:splat    301
/u/*    https://app.callmagnet.com.au/u/:splat    301
/reset-password    https://app.callmagnet.com.au/reset-password    301
/payment-success    https://app.callmagnet.com.au/payment-success    301
```

## Rule-by-Rule Explanation

| Rule | Plain English |
|---|---|
| `/b/*` → `cm1.au/:splat` | Any old Middle Man link using the old callmagnet.com.au/b/ path gets sent to cm1.au instead. Protects any bookmarked links. |
| `/u/*` → `app.callmagnet.com.au/u/:splat` | SMS opt-out links that use callmagnet.com.au/u/... still work and land on the correct unsubscribe page. |
| `/reset-password` → `app.callmagnet.com.au/reset-password` | Password reset emails that still reference the old domain land on the correct reset page. |
| `/payment-success` → `app.callmagnet.com.au/payment-success` | Stripe payment success redirects that still reference the old domain land on the correct confirmation page. |

## What Is NOT in this file

- No redirect from `/` to `app.callmagnet.com.au` — the root stays as the marketing site homepage.
- No catch-all `/*` rule — all other paths on callmagnet.com.au return the marketing site or 404.
