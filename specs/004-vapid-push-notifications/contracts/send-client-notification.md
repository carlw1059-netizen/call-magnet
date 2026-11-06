# Contract: send-client-notification

**Edge Function**: `supabase/functions/send-client-notification/index.ts`
**Status**: Needs modification (link_tapped routing change only)

---

## Endpoint

`POST /functions/v1/send-client-notification`

## Auth

Headers: `X-Internal-Secret: <INTERNAL_SECRET>`, `Authorization: Bearer <SERVICE_ROLE_KEY>`

## Request Body (unchanged)

```json
{
	"client_id": "uuid",
	"event": "link_tapped | missed_call | booking_logged",
	"context": {
		"push_title": "string",
		"push_message": "string",
		"customer_number": "string (E.164)"
	}
}
```

## Routing Change (link_tapped only)

**Before**: `link_tapped` always calls Progressier API.

**After**:
- If `push_subscriptions` has rows for this client → VAPID fan-out
- If empty → Progressier API fallback (per spec FR-007)

`missed_call` and `booking_logged` are unchanged (already use VAPID fan-out; no fallback per FR-008).

## VAPID Push Payload (for our push handler)

```json
{
	"source": "callmagnet-vapid",
	"title": "string",
	"body": "string",
	"url": "https://callmagnet.com.au"
}
```

`source: 'callmagnet-vapid'` is checked by `service-worker.js` push handler.

## Callers

- `log-middle-man-tap/index.ts`
- `submit-middle-man-form/index.ts`
- `twilio-missed-call/index.ts`
- `log-booking/index.ts`
