# Twilio Function: fetch-client-vertical

Looks up a CallMagnet client record in Supabase by their Twilio number, then
returns the client's vertical, business name, and booking URL so the Studio
flow can pick the right SMS reply message.

---

## Important: why this exists

The existing Twilio Studio flow already logs missed calls to Supabase via the
`twilio-missed-call` edge function. The SMS reply that goes back to the caller
is sent by Studio's **Send Message** widget — and today that widget has a
hardcoded message. This function gives Studio the data it needs to send a
different message depending on whether the client is a restaurant or a
hairdresser/barber.

---

## Step 1 — Open Twilio Console

Go to [console.twilio.com](https://console.twilio.com) and log in.

---

## Step 2 — Create a new Serverless Service

1. In the left sidebar, click **Develop** → **Functions and Assets** → **Services**.
2. Click the blue **Create Service** button.
3. Name it exactly: `callmagnet-helpers`
4. Click **Next**.

---

## Step 3 — Add the function file

1. Inside the service, click **Add** → **Add Function**.
2. Name the path: `/fetch-client-vertical`
   (Twilio will show it as `/fetch-client-vertical` in the path field.)
3. In the visibility dropdown, choose **Public**.
   *(Public means it can be called by Twilio Studio without extra auth headers.)*
4. Click the function to open its code editor.
5. Delete the placeholder code that Twilio puts there.
6. Open `twilio-functions/fetch-client-vertical.js` from this repo in a text
   editor, copy the entire contents, and paste it into the Twilio editor.

---

## Step 4 — Add environment variables

1. In the left panel of the service editor, click **Environment Variables**.
2. Add these two variables exactly as shown:

   | Key | Value |
   |-----|-------|
   | `SUPABASE_URL` | `iskvvnhacqdxybpmwuni.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | *(your Supabase service role key — see below)* |

   **How to find your Supabase service role key:**
   - Go to [supabase.com](https://supabase.com) → your project → **Settings** (gear icon) → **API**.
   - Under **Project API keys**, find the row labelled **service_role**.
   - Click "Reveal" and copy that key.
   - ⚠️ **Do NOT use the "anon public" key here.** The clients table has
     row-level security that blocks unauthenticated reads. The service role
     key bypasses that restriction. This function runs on Twilio's servers
     and the key is never sent to anyone's browser, so using service role
     here is safe.

---

## Step 5 — Deploy

1. Click the blue **Deploy All** button at the bottom of the screen.
2. Wait for the green "Deployment successful" banner.

---

## Step 6 — Note the function URL

After deploying, the function URL will look like:

```
https://callmagnet-helpers-XXXX.twil.io/fetch-client-vertical
```

Where `XXXX` is a random string Twilio assigns to your service. You can find
the full URL by clicking **…** next to the function name → **Copy URL**, or by
looking in the **Settings** tab of the service.

---

## Step 7 — Test the function in isolation

Before wiring it into Studio, confirm it returns data correctly by calling it
directly. Open PowerShell and run:

```powershell
curl.exe "https://callmagnet-helpers-XXXX.twil.io/fetch-client-vertical?To=%2B61468083169"
```

Replace `XXXX` with your actual service subdomain, and replace `%2B61468083169`
with your Twilio number URL-encoded (`+` becomes `%2B`, rest of digits as-is).

**Expected response for the Test Business number:**
```json
{"vertical":"restaurant","business_name":"Test Business","booking_url":"http://fresha.com"}
```

**If you get the fallback instead:**
```json
{"vertical":"default","business_name":"us","booking_url":"https://callmagnet.com.au"}
```
…check the function logs in Twilio Console (click **Logs** in the service
editor) to see the error. Common causes: wrong `SUPABASE_SERVICE_ROLE_KEY`,
or `SUPABASE_URL` has an accidental `https://` prefix.

---

## Step 8 — Wire the function into Studio

Open your Twilio Studio flow (the one that handles missed calls).

**Current flow shape:** `Incoming Call trigger → [missed-call branch] → http_1 (logs to Supabase) → sms_reply (sends SMS)`

**New flow shape:** `... → http_1 → fetch_client (this function) → sms_reply`

### 8a — Add a Run Function widget

1. Drag a **Run Function** widget onto the canvas.
2. Name it `fetch_client` (this name appears in the Liquid template — use
   this exact name or update the template in step 8b accordingly).
3. In the widget settings:
   - **Function URL:** paste the URL from Step 6.
   - **Function Parameters:** click **Add Parameter** and add one row:
     - Key: `To`
     - Value: `{{trigger.call.To}}`

### 8b — Connect the widgets

- Disconnect the wire from `http_1` that currently goes to `sms_reply`.
- Connect `http_1` → `fetch_client` (use the "Success" transition).
- Connect `fetch_client` → `sms_reply` (use the "Success" transition).
- Also connect `fetch_client`'s "Fail" transition → `sms_reply` (the fallback
  values mean sms_reply will still work even if the function errors).

### 8c — Update the Send Message body

Click the `sms_reply` widget. Replace whatever is in the **Message Body**
field with the template below (see Step 9).

### 8d — Save and Publish

Click **Save** then **Publish**.

---

## Step 9 — Liquid template for sms_reply Message Body

Paste this exactly into the `sms_reply` widget's **Message Body** field.
If you named your Run Function widget something other than `fetch_client`,
replace `fetch_client` in both `widgets.fetch_client` references below.

```
{% assign vertical = widgets.fetch_client.parsed.vertical | default: 'default' %}
{% assign biz = widgets.fetch_client.parsed.business_name | default: 'us' %}
{% assign url = widgets.fetch_client.parsed.booking_url | default: '' %}
{% assign restaurant_msg = 'Hi — you called ' | append: biz | append: '. Sorry we missed you. Book: ' | append: url | append: ' Reply STOP to opt out' %}
{% if vertical == 'restaurant' and restaurant_msg.size <= 160 %}{{ restaurant_msg }}{% else %}Hi — sorry we missed your call. Tap to book: {{ url }} Reply STOP to opt out{% endif %}
```

**What this does:**
- Reads the vertical, business name, and booking URL returned by the function.
- If the client is a restaurant AND the personalised message fits within 160
  characters (one SMS segment), sends:
  `Hi — you called Test Business. Sorry we missed you. Book: http://fresha.com Reply STOP to opt out`
- Otherwise, sends the generic fallback:
  `Hi — sorry we missed your call. Tap to book: http://fresha.com Reply STOP to opt out`

The 160-character guard prevents a long business name or URL from splitting the
message into two SMS segments (which costs double).

---

## Keeping vertical in sync

The CallMagnet admin toggle (the 🍽️ / 👩 buttons on the dashboard) now writes
the `vertical` field directly to the database when tapped. This means:

- Tap 🍽️ on the dashboard → `clients.vertical` becomes `'restaurant'`
  → next missed call gets the restaurant SMS
- Tap 👩 → `clients.vertical` becomes `'barber'`
  → next missed call gets the generic SMS

No manual database edits needed to switch templates.
