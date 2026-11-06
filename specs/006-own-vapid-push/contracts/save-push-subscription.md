# Contract: `save-push-subscription` edge function

**Feature**: `006-own-vapid-push` | **Date**: 2026-09-26

**No changes to this function are required for this feature.** This document records the existing contract for reference.

---

## Endpoint

`POST /functions/v1/save-push-subscription`

## Authentication

`X-Internal-Secret` header (shared secret from Vault) + valid Supabase session (passed automatically by the dashboard).

## Request body

```json
{
	"client_id": "<uuid>",
	"endpoint": "<push service URL>",
	"p256dh": "<base64url public key>",
	"auth": "<base64url auth secret>"
}
```

All four fields required.

## Behaviour

- Deletes any existing `push_subscriptions` row for `client_id`.
- Inserts the new row.
- Returns `200 { ok: true }` on success.

## Caller change in this feature

Previously called on page load inside `registerVapidPush()`. After this feature, called only from the "Turn on notifications" button tap handler — never on page load.
