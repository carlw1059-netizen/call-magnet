## Known Bugs & Fix History

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

### clients-admin.js back button
- **Bug**: Back button on clients page navigated to /admin/ (404)
- **Root cause**: window.location.href = '/admin/' hardcoded in clients-admin.js
- **Fix**: Changed all three instances to window.location.href = '/'

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
