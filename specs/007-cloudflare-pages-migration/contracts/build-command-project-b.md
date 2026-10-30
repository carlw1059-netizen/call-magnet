# Contract: Build Command — Project B (app.callmagnet.com.au)

## What this build command does

At deploy time, Cloudflare Pages runs this command before serving the site. It replaces placeholder text in the JavaScript files with the real Supabase credentials stored as environment variables. This is how the dashboard connects to the database without hardcoding secrets.

## Build Command (verbatim from netlify.toml)

Paste this exactly into the CF Pages "Build command" field:

```bash
sed -i 's/\r//' assets/js/clients-admin.js assets/js/dashboard.js assets/js/middle-man-admin.js assets/js/middleman.js assets/js/onboard.js reset-password.html service-worker.js && CLEAN_URL=$(echo -n "$SUPABASE_URL" | tr -d '\n\r') && CLEAN_ANON=$(echo -n "$SUPABASE_ANON_KEY" | tr -d '\n\r') && CLEAN_VAPID=$(echo -n "$VAPID_PUBLIC_KEY" | tr -d '\n\r') && sed -i 's|%%SUPABASE_URL%%|'"$CLEAN_URL"'|g' assets/js/clients-admin.js assets/js/dashboard.js assets/js/middle-man-admin.js assets/js/middleman.js assets/js/onboard.js reset-password.html && sed -i 's|%%SUPABASE_ANON_KEY%%|'"$CLEAN_ANON"'|g' assets/js/clients-admin.js assets/js/dashboard.js assets/js/middle-man-admin.js assets/js/middleman.js assets/js/onboard.js reset-password.html service-worker.js && sed -i 's|%%VAPID_PUBLIC_KEY%%|'"$CLEAN_VAPID"'|g' index.html
```

## Environment Variables to Set in CF Pages

| Variable | Where to find the value |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → anon/public key |
| `VAPID_PUBLIC_KEY` | Currently set in Netlify environment variables — copy from there |

## Build Output Directory

Leave blank (or set to `/`) — the repo root is the output.

## Skip Builds Rule (optional, recommended)

To avoid unnecessary deploys when only docs or Supabase functions change, set the "Skip builds" condition in CF Pages to match changes only to these paths. This mirrors the `ignore` rule in `netlify.toml`.
