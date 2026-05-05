# Twilio Studio — restaurant-vertical SMS template

**Status:** documentation only. No code change, no deployment. Carl pastes the
expression into the Twilio Studio Send Message widget when he's ready.

The CallMagnet edge function `twilio-missed-call` only logs the missed call to
`sms_events`. The customer-facing SMS reply is sent by the Twilio Studio flow,
so per-vertical wording lives in Studio, not in this repo.

---

## What goes where

In the Twilio Studio flow that receives the missed call (the same flow whose
HTTP Request widget already POSTs to `https://<project>.supabase.co/functions/v1/twilio-missed-call`):

1. **Add an HTTP Request widget** named `fetch_client` *immediately after* the
   missed-call branch and *before* the existing Send Message widget.
   - **Method:** `GET`
   - **URL:** `https://iskvvnhacqdxybpmwuni.supabase.co/rest/v1/clients?twilio_number=eq.{{trigger.call.To | url_encode}}&select=business_name,booking_url,vertical`
   - **Content Type:** `Application/JSON`
   - **HTTP Headers:**
     - `apikey` → `<SUPABASE_ANON_KEY>` (same anon key the dashboard uses)
     - `Authorization` → `Bearer <SUPABASE_ANON_KEY>`
   - **Parameters:** none.

2. **In the Send Message widget**, replace the **Message Body** field with the
   expression below. It picks the restaurant template when
   `vertical == 'restaurant'`, falls back to the default otherwise, and falls
   back again if the rendered restaurant template would exceed 160 characters.

   ```liquid
   {% assign client = widgets.fetch_client.parsed[0] %}
   {% assign biz = client.business_name | default: 'us' %}
   {% assign url = client.booking_url | default: '' %}
   {% assign restaurant_msg = 'Hi — you called ' | append: biz | append: '. Sorry we missed you. Book: ' | append: url | append: ' Reply STOP to opt out' %}
   {% if client.vertical == 'restaurant' and restaurant_msg.size <= 160 %}{{ restaurant_msg }}{% else %}Hi — sorry we missed your call. Tap to book: {{ url }} Reply STOP to opt out{% endif %}
   ```

3. **Save & Publish** the flow. Test by ringing the Test Business Twilio number
   (+61 468 083 169) from another phone and letting it go to voicemail — the
   reply SMS should land within a few seconds.

---

## Sample render — Test Business

With the live row in `clients`:

| Field          | Value                                              |
| -------------- | -------------------------------------------------- |
| business_name  | `Test Business`                                    |
| booking_url    | `https://example.com/book/test`                    |
| vertical       | `restaurant`                                       |

The template renders to:

```
Hi — you called Test Business. Sorry we missed you. Book: https://example.com/book/test Reply STOP to opt out
```

Length: 109 characters. Within the 160-char single-segment SMS budget, so the
restaurant branch is taken.

If a future client has a long `business_name + booking_url` combination that
pushes the total over 160 characters, Studio falls back to the default
template (`"Hi — sorry we missed your call. Tap to book: {url} Reply STOP to opt out"`)
to avoid splitting into a multi-part SMS billed as two segments.

---

## Why we did it this way (and not in the edge function)

Keeping SMS sending in Studio matches the existing architecture: the edge
function is a pure logger (idempotent on `twilio_call_sid`), and Studio owns
the Twilio API call. Moving sending into the edge function would have meant
either disabling Studio's Send Message widget (risk of double-sending if the
two paths drift) or building a parallel send path. Neither is justified for
the vertical wording change alone.

If we ever need per-client SMS template overrides (e.g. a client edits their
own SMS copy from the dashboard), the right next step is a `clients.sms_template`
column the Studio widget reads via the same `fetch_client` lookup — no new
edge function required.
