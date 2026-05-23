// admin-nav.js — shared admin gear FAB + slide-out panel for all admin pages.
//
// Include AFTER the Supabase CDN script in any admin page:
//   <script src="/admin/admin-nav.js"></script>
//
// Then call window.refreshAdminFab(session) once after the page confirms the
// user is an authenticated admin. The FAB is hidden until that call is made.
//
// Reads `sb`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` from the page's global
// scope — all admin pages declare these as top-level consts in their own
// <script> block, which share the same global scope as this file.

(function () {
  'use strict';

  const ADMIN_EMAIL = 'car312@hotmail.com';

  // ── 1. Inject CSS ──────────────────────────────────────────────────────────
  // Uses explicit font stacks (not CSS vars) so it works on admin pages that
  // don't inherit the dashboard :root variable declarations.
  const style = document.createElement('style');
  style.textContent = `
.admin-fab {
  position: fixed; bottom: 24px; right: 20px; z-index: 9000;
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(14, 20, 25, 0.92);
  border: 1px solid rgba(6, 214, 160, 0.5);
  box-shadow: 0 0 24px rgba(6, 214, 160, 0.35), 0 4px 16px rgba(0, 0, 0, 0.45);
  color: #06D6A0; text-decoration: none;
  font-size: 24px; line-height: 1;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  transition: transform 0.12s, box-shadow 0.15s;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  border: none;
  -webkit-appearance: none; appearance: none;
}
.admin-fab:hover {
  box-shadow: 0 0 32px rgba(6, 214, 160, 0.55), 0 4px 16px rgba(0, 0, 0, 0.45);
  transform: translateY(-1px);
}
.admin-fab:active { transform: scale(0.96); }
.admin-fab-icon { display: block; }
@media (max-width: 767px) { .admin-fab { bottom: 92px; } }

.admin-panel-overlay {
  position: fixed; inset: 0; z-index: 9100;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  opacity: 0; pointer-events: none;
  transition: opacity 0.25s ease;
}
.admin-panel-overlay.open { opacity: 1; pointer-events: auto; }

.admin-panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 9200;
  width: 85%; max-width: 400px;
  background: #0E1419;
  border-left: 1px solid rgba(6,214,160,0.15);
  transform: translateX(100%);
  transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
  display: flex; flex-direction: column;
  overflow-y: auto; -webkit-overflow-scrolling: touch;
}
.admin-panel.open { transform: translateX(0); }

.admin-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 20px 16px;
  border-bottom: 1px solid rgba(6,214,160,0.12);
  flex-shrink: 0;
}
.admin-panel-title {
  font-family: 'DM Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 13px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: #06D6A0;
}
.admin-panel-close {
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.7); font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s; flex-shrink: 0;
  -webkit-appearance: none; appearance: none;
}
.admin-panel-close:hover { background: rgba(255,255,255,0.12); color: #fff; }

.admin-panel-body { padding: 20px; flex: 1; }
.admin-panel-section { margin-bottom: 28px; }
.admin-panel-section-label {
  font-family: 'DM Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase; color: #06D6A0;
  margin-bottom: 10px; display: block;
}
.admin-panel-link {
  display: block; width: 100%;
  padding: 12px 14px; margin-bottom: 6px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px; color: rgba(255,255,255,0.88); font-size: 14px;
  text-decoration: none; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.4; box-sizing: border-box;
  -webkit-appearance: none; appearance: none;
}
.admin-panel-link:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(6,214,160,0.3);
}
.admin-panel-link:disabled { opacity: 0.6; cursor: default; }
.admin-panel-link.destructive { color: #CC5500; border-color: rgba(204,85,0,0.2); }
.admin-panel-link.destructive:hover {
  background: rgba(204,85,0,0.08);
  border-color: rgba(204,85,0,0.4);
}
@media (max-width: 767px) { .admin-panel-testing { display: none; } }
`;
  document.head.appendChild(style);

  // ── 2. Inject HTML into <body> ─────────────────────────────────────────────
  function injectHTML() {
    // FAB — hidden until refreshAdminFab() confirms the real admin
    const fab = document.createElement('button');
    fab.id        = 'adminFab';
    fab.className = 'admin-fab';
    fab.style.display = 'none';
    fab.title     = 'Admin tools';
    fab.setAttribute('aria-label', 'Open admin tools');
    fab.setAttribute('type', 'button');
    fab.onclick   = openAdminPanel;
    fab.innerHTML = '<span class="admin-fab-icon">⚙</span>';
    document.body.appendChild(fab);

    // Overlay (click-outside to close)
    const overlay = document.createElement('div');
    overlay.id        = 'adminPanelOverlay';
    overlay.className = 'admin-panel-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.onclick   = closeAdminPanel;
    document.body.appendChild(overlay);

    // Panel — includes "Back to Dashboard" at the top
    const panel = document.createElement('div');
    panel.id        = 'adminPanel';
    panel.className = 'admin-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Admin tools');
    panel.innerHTML = `
      <div class="admin-panel-header">
        <span class="admin-panel-title">★ Admin Tools</span>
        <button class="admin-panel-close" type="button" onclick="closeAdminPanel()" aria-label="Close">✕</button>
      </div>
      <div class="admin-panel-body">
        <div class="admin-panel-section">
          <span class="admin-panel-section-label">Navigate</span>
          <a href="/" class="admin-panel-link">← Back to Dashboard</a>
        </div>
        <div class="admin-panel-section">
          <span class="admin-panel-section-label">Clients</span>
          <a href="/admin/onboard.html" class="admin-panel-link">Onboard new client</a>
          <a href="/admin/clients.html" class="admin-panel-link">Manage clients</a>
          <a href="/admin/middle-man.html" class="admin-panel-link">Middle Man</a>
          <a href="/admin/unsubscribes.html" class="admin-panel-link">Unsubscribes</a>
        </div>
        <div class="admin-panel-section">
          <span class="admin-panel-section-label">Subscription</span>
          <a href="/cancel.html" class="admin-panel-link destructive">Cancel subscription</a>
        </div>
        <div class="admin-panel-section admin-panel-testing">
          <span class="admin-panel-section-label">Testing</span>
          <button id="adminNavTestNotifBtn" type="button" class="admin-panel-link"
                  onclick="adminNavSendTestNotification()">Send test notification</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectHTML);
  } else {
    injectHTML(); // already parsed
  }

  // ── 3. Panel open / close ──────────────────────────────────────────────────
  window.openAdminPanel = function openAdminPanel() {
    var p = document.getElementById('adminPanel');
    var o = document.getElementById('adminPanelOverlay');
    if (p) p.classList.add('open');
    if (o) o.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.closeAdminPanel = function closeAdminPanel() {
    var p = document.getElementById('adminPanel');
    var o = document.getElementById('adminPanelOverlay');
    if (p) p.classList.remove('open');
    if (o) o.classList.remove('open');
    document.body.style.overflow = '';
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.closeAdminPanel();
  });

  // ── 4. Auth gate — called by each page after admin auth is confirmed ────────
  // Shows the FAB only when:
  //   • session.user.app_metadata.is_admin === true  AND
  //   • session.user.email (lowercased) === ADMIN_EMAIL
  // Keeps the same dual-gate as the dashboard.
  window.refreshAdminFab = function refreshAdminFab(session) {
    var isAdmin  = session && session.user &&
                   session.user.app_metadata &&
                   session.user.app_metadata.is_admin === true;
    var email    = (session && session.user && session.user.email)
                   ? session.user.email.toLowerCase() : '';
    var showFab  = isAdmin && (email === ADMIN_EMAIL);
    var fab      = document.getElementById('adminFab');
    if (fab) fab.style.display = showFab ? 'flex' : 'none';
  };

  // ── 5. Send test notification ──────────────────────────────────────────────
  // Uses `sb`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` from the page's global scope.
  // Button id: adminNavTestNotifBtn (different from the sidebar's testNotifBtn
  // in onboard.html — avoids any ID collision).
  window.adminNavSendTestNotification = async function adminNavSendTestNotification() {
    var btn = document.getElementById('adminNavTestNotifBtn');
    if (!btn || btn.disabled) return;
    var orig = btn.textContent;
    btn.textContent = 'Sending…';
    btn.disabled = true;
    try {
      /* global sb, SUPABASE_URL, SUPABASE_ANON_KEY */
      var authResult = await sb.auth.getSession();
      var session    = authResult.data && authResult.data.session;
      if (!session) {
        btn.textContent = 'Not signed in';
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 2500);
        return;
      }
      var res = await fetch(SUPABASE_URL + '/functions/v1/send-test-notification', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey':        SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ client_id: null }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok) {
        btn.textContent = '✓ Sent!';
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 2500);
      } else {
        btn.textContent = 'Failed: ' + (data.error || res.status);
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 3000);
      }
    } catch (err) {
      btn.textContent = 'Error — check console';
      console.error('adminNavSendTestNotification:', err);
      setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 3000);
    }
  };
})();
