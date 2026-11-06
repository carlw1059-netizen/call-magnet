# Contract: save-push-subscription

**Edge Function**: `supabase/functions/save-push-subscription/index.ts`
**Status**: Exists and is correct — do not modify

---

## Endpoint

`POST /functions/v1/save-push-subscription`

## Auth

Header: `X-Internal-Secret: <INTERNAL_SECRET>`

INTERNAL_SECRET is injected into `dashboard.js` at build time via netlify.toml sed. The edge function code explicitly approves frontend exposure of this secret (it only gates a low-stakes write; actual data access still requires service_role).

## Request Body

```json
{
	"client_id": "uuid",
	"endpoint": "https://...",
	"p256dh": "base64url string",
	"auth": "base64url string",
	"user_agent": "string"
}
```

## Behaviour

- UPSERTs into `push_subscriptions` on `(client_id, endpoint)`
- Returns `{ ok: true }` on success

## Caller

`registerVapidPush()` in `assets/js/dashboard.js` — called on every login after `progressier.add()`.
