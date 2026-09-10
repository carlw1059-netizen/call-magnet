## Known Bugs & Fix History

### Auth screen architecture — password reset flow
- **Rule**: callmagnet.com.au MUST only ever show the login screen. It must NEVER show a password reset form.
- **How reset works**: `handleReset()` in dashboard.js calls `sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://callmagnet.com.au/reset-password' })`. The reset form lives exclusively at `reset-password.html`. Do not move it back to the main page under any circumstances.
- **reset-password.html**: Standalone page. Gets Supabase credentials injected at build time by netlify.toml (the sed command). If you add any new HTML files that need Supabase credentials, they must be added to the netlify.toml build command in all three sed operations.
- **What NOT to do**: Never call `request-login-link` edge function from `handleReset()` — that function sends magic sign-in links, not recovery links. Never set `redirectTo` back to `'https://callmagnet.com.au/'` — recovery links must go to `/reset-password`.
- **_isPasswordRecoveryFlow flag**: Set at parse time (before DOMContentLoaded) by checking `window.location.hash.includes('type=recovery')`. The `onAuthStateChange` PASSWORD_RECOVERY handler is gated behind this flag. Never remove this gate — without it, spurious PASSWORD_RECOVERY events show the recovery screen on the main page.
- **Black screen**: Was caused by dead code in `crossFadeToDashboard` that hid both the dash and fromEl when `loadDashboard` returned `'must_change_password'`. That check and that return value are both gone. Never re-add a `must_change_password` branch to `loadDashboard` or `crossFadeToDashboard`.
- **#dash default state**: Must have `style="display:none"` in index.html. Without it, the dashboard flashes visible during the async getSession() call on every page load. Never remove this inline style.
- **OTP tokens**: Each call to `resetPasswordForEmail` generates a new token and invalidates all previous ones for that email. If testing, always use the most recent reset email. Do not click links from earlier test emails.

### Glow bleed on mm-tiles — right edge of screen
- **Bug**: After closing a tile panel, the tile's neon colour bled out to the right edge of the screen
- **Root cause**: The mm-tile box-shadow uses rgba values that extend beyond the viewport
- **What NOT to do**: Never add overflow:hidden to .mm-section or .mm-grid — it clips the top of the tiles and causes a large gap below the biz-tagline
- **Status**: Unresolved — do not attempt overflow:hidden again

### Tile top clipping + gap below biz-tagline
- **Bug**: Top of first row of mm-tiles was cut off, large gap appeared between "PULL EVERY CUSTOMER BACK." and "Customer requests"
- **Root cause**: overflow:hidden on .mm-section and padding:4px on .mm-grid (commit d102e25)
- **Fix**: Remove overflow:hidden from .mm-section and .mm-section.visible, remove padding from .mm-grid
- **What NOT to do**: Never add overflow:hidden to .mm-section or .mm-grid

### Git push missing after commits
- **Bug**: Commits were made locally but never pushed — live site didn't update
- **Root cause**: Claude Code was not including git push in commit commands
- **Fix**: Every single commit command must end with && git push origin main — no exceptions

### Admin hub (/admin/index.html) — deleted
- **Bug**: /admin/ was a dead iframe hub page that appeared when back buttons redirected to /admin/
- **Root cause**: clients-admin.js had window.location.href = '/admin/' on lines 332, 340, 350
- **Fix**: All redirects changed to /. admin/index.html deleted. All admin tools are now standalone pages
- **What NOT to do**: Never recreate admin/index.html. Never link to /admin/. All back buttons go to /

### iOS service worker caching
- **Bug**: CSS/JS changes not appearing on iOS Safari even after hard refresh
- **Root cause**: Service worker caches aggressively on iOS
- **Fix**: Bump CACHE_VERSION in service-worker.js AND bump version strings on dashboard.css and dashboard.js in index.html
- **What NOT to do**: Do not tell the user it's an iPhone problem — it is a service worker cache problem

### iOS video background not showing / requiring tap on Middle Man page
- **Bug**: Video background missing on iOS Safari, or video present but requires tap to start — autoplay not firing
- **Root cause**: The video MP4 file has its `moov` atom (metadata) at the END of the file (non-faststart encoding). iOS must do a byte-range HTTP request to fetch `moov` before it can play. Any `vid.play()` call that fires BEFORE `canplay` will be rejected with `NotAllowedError` because iOS doesn't have the metadata yet. `canplay` fires only after iOS has successfully fetched `moov` and buffered enough to begin — at that point `play()` always succeeds.
- **The regression pattern**: Every time this was "fixed" by moving `play()` somewhere other than inside the `canplay` listener (`loadedmetadata`, immediately after `load()`, `DOMContentLoaded`, etc.) it broke on iOS. The ONLY safe place to call `play()` is inside `canplay`.
- **What broke it in June 2026**: The service worker was caching an old JS version that had no `logClick`. When SW cache was bumped, the device fetched the current JS which had `logClick` firing a concurrent fetch before `fetchClient`. Even after `logClick` was moved, `play()` was placed inside `loadedmetadata` which never fires reliably on iOS for non-faststart MP4. The fix was restoring `play()` to `canplay`.
- **Fix**: Call `play()` ONLY inside the `canplay` event listener with `{ once: true }`, wired BEFORE `bgFixed.appendChild(vid)` and BEFORE `vid.load()`. Confirmed working: commits `59299e4` and `8de0596`.
- **What NEVER to do**:
  - NEVER call `vid.play()` immediately after `vid.load()` — always fails on iOS non-faststart MP4
  - NEVER call `vid.play()` inside `loadedmetadata` — fires before iOS has buffered enough, still fails
  - NEVER call `vid.play()` at the top level of the video setup block — same problem
  - NEVER call `vid.style.display = 'none'` anywhere in video error/catch handlers — video must always stay visible
  - NEVER set `bgFixed.style.backgroundColor` to hide the video on error
  - NEVER move `play()` out of `canplay` for any reason — if autoplay seems broken, the answer is always to restore `play()` to `canplay`, not to try a different event
- **Working code shape** — this exact pattern must never be changed (in `render()` inside the `bgType === 'video'` block):
  ```js
  vid.addEventListener('canplay', function() {
    vid.play().catch(function(err) {
      console.warn('[video] play() blocked after canplay:', err.name);
      // do NOT hide — poster frame keeps the background visible
    });
  }, { once: true });
  bgFixed.appendChild(vid);
  vid.load();
  ```

### Video upload — faststart encoding required
- **Rule**: Every MP4 video uploaded to any client's Middle Man page MUST be pre-encoded with faststart (moov atom at start of file) before upload. Non-faststart MP4 will not autoplay on iOS Safari regardless of any code changes.
- **Why**: iOS Safari requires the moov atom at the START of the file to autoplay without user gesture. Non-faststart files have moov at the END — iOS must download the entire file before it can play, which blocks autoplay.
- **ffmpeg path on Carl's machine**: C:\Users\car31\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe
- **Command to re-encode any video before upload** (run in Claude Code PowerShell):
  ```powershell
  $ffmpeg = "C:\Users\car31\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe"
  & $ffmpeg -ss 00:00:00.5 -i "input.mp4" -movflags faststart -acodec copy -vcodec copy "output_faststart.mp4" -y
  ```
- **After re-encoding**: Upload output_faststart.mp4 via the admin edit view → Background Media → Upload video
- **Never upload a raw MP4** from a client without running this command first
- **What NOT to do**: Never attempt to fix iOS autoplay by changing middleman.js, b.html, cm1site/b.html, or service-worker.js — the code is correct. The file is always the problem.

### VIDEO UPLOAD — CLIENT ONBOARDING PROCESS

Rule: Any MP4 video for any client MUST be faststart-encoded before upload. No exceptions. The upload-middle-man-background edge function will reject non-faststart files.

Step 1 — Place the client's raw video file in C:\Users\car31\call-magnet

Step 2 — Run this prompt in Claude Code:

Read CLAUDE.md first. Run the following ffmpeg command to faststart-encode the video. Replace input.mp4 with the actual filename of the client video. Run in PowerShell:

$ffmpeg = "C:\Users\car31\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe"
& $ffmpeg -ss 00:00:00.5 -i "input.mp4" -movflags faststart -acodec copy -vcodec copy "output_faststart.mp4" -y

Then confirm output_faststart.mp4 exists in C:\Users\car31\call-magnet and that the file size is within 10% of the input file size. Report both file sizes. Do not upload anything.

Step 3 — Upload output_faststart.mp4 via the admin panel Background Media section for the client.

Step 4 — Delete both input.mp4 and output_faststart.mp4 from C:\Users\car31\call-magnet after confirming the video plays correctly on the live Middle Man page.

### clients-admin.js back button
- **Bug**: Back button on clients page navigated to /admin/ (404)
- **Root cause**: window.location.href = '/admin/' hardcoded in clients-admin.js
- **Fix**: Changed all three instances to window.location.href = '/'

---

## PROTECTED BASELINE — NEVER OVERWRITE

Tag: baseline-working-20260824
Confirmed working: 24 August 2026 — Arcane Fairies correct, zero staging URLs.

Revert command (restores all four Middle Man files to confirmed working state):
git checkout baseline-working-20260824 -- assets/css/middleman.css assets/js/middleman.js b.html cm1site/b.html

After any revert:
1. Bump middleman.css version string in both b.html and cm1site/b.html
2. Run: grep "staging" b.html cm1site/b.html — zero output required
3. Commit and push
4. Confirm live on cm1.au/arcane-fairies on a real device before proceeding

RULES — NEVER BREAK:
- Never make changes to middleman.css, middleman.js, b.html or cm1site/b.html without bumping version strings in both HTML files in the same commit
- Never commit without running: grep "staging" b.html cm1site/b.html — zero output required
- After every change to middleman.css or middleman.js: visually confirm cm1.au/arcane-fairies on a real device — logo fully visible, all 6 buttons on screen, layout unchanged
- If anything looks wrong on Arcane Fairies: stop, run revert command above, confirm live, then get diagnostic data before trying again
- One file per commit — never CSS and JS together

## BASELINE 2 — BREATHING GLOW (confirmed working 24 Aug 2026)

Tag: baseline-breathing-glow-20260824
Commit: 4de90d8
CSS version: v=20260824e

Feature: Breathing glow on all Middle Man buttons.
- All buttons breathe by default — the static neon glow is now animated
- Glow on/off toggle (btn.animate === false) correctly stops the breathing animation via .tap-btn.glow-off { animation: none }
- Form-open kill switch prevents animation from creating a line at the top of the open form via .btn-unit.form-open .tap-btn { animation: none !important }
- No JS changes — CSS only feature

Revert command (restores to breathing glow confirmed working state):
git checkout baseline-breathing-glow-20260824 -- assets/css/middleman.css b.html cm1site/b.html

---

## VIDEO SYNC RULES — NEVER BREAK

* Every change to middleman.js must bump the version string in BOTH b.html AND cm1site/b.html
* cm1site/b.html must always match root b.html exactly — sync after every change to either file
* Never deploy a middleman.js change without first confirming both HTML files reference the same version string
* Never upload a client video without faststart encoding — moov atom must be at the start of the file
* Never upload HEVC/H.265 video — always H.264
* ffmpeg re-encode command: & "C:\Users\car31\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe" -i "input.mp4" -movflags faststart -an -vcodec copy "output-faststart.mp4" -y
* cm1site/b.html must always use ABSOLUTE URLs for all assets (https://callmagnet.com.au/...) — never relative paths. The cm1.au _redirects catch-all (/* /b.html 200) will intercept any relative path request and serve HTML instead of the asset, breaking the page silently.
* root b.html may use relative paths — callmagnet.com.au serves the files directly.

---

## Locked Standards — Admin Pages

Every admin page must follow these rules. No exceptions. No deviations.

- **Page background**: #F5F5F5
- **Cards**: white background, box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 2px 0 rgba(6,214,160,0.4), border-radius: 10px, border: 1px solid #000000
- **Headings/labels**: #10b981 emerald
- **Body text**: #000000 black
- **Back/Dashboard button**: background #CC0000, hover #AA0000, always navigates to /
- **No sidebars**: Admin pages have no left column or tools sidebar — that belongs on the main dashboard only
- **No iframes**: No admin page loads inside an iframe
- **Single column nav**: Any nav on admin pages is single column only


## Deployment

All changes go directly to main. Staging branch is not used.
