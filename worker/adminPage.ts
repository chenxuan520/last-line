export function adminPage(turnstileSiteKey: string | null): Response {
  const nonce = randomNonce();
  const turnstileScript = turnstileSiteKey
    ? `<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>`
    : "";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="data:," />
  <title>最后防线 · 管理终端</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; --ink:#e8e5d8; --muted:#8f948d; --line:#343934; --panel:#151916; --accent:#d7ff3f; --danger:#ff654f; --blue:#65b8ff; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:radial-gradient(circle at 85% 10%,#27301d 0,transparent 28%),#090c0a; font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.14; background:repeating-linear-gradient(0deg,transparent 0 3px,#fff 4px); }
    button,input { font:inherit; }
    button { cursor:pointer; }
    .shell { width:min(1400px,calc(100% - 32px)); margin:0 auto; padding:28px 0 64px; }
    .topbar { display:flex; align-items:end; justify-content:space-between; gap:20px; border-bottom:1px solid var(--line); padding-bottom:18px; }
    .eyebrow { color:var(--accent); letter-spacing:.18em; text-transform:uppercase; }
    h1,h2,p { margin:0; }
    h1 { font:700 clamp(28px,5vw,58px)/.9 system-ui,sans-serif; letter-spacing:-.06em; }
    h2 { font:700 17px/1.2 system-ui,sans-serif; }
    .status { color:var(--muted); min-height:22px; }
    .status.bad { color:var(--danger); }
    .auth { width:min(520px,100%); margin:10vh auto 0; padding:28px; border:1px solid var(--line); background:linear-gradient(145deg,#1b211c,#101310); box-shadow:12px 12px 0 #050705; }
    .auth form,.stack { display:grid; gap:14px; margin-top:24px; }
    label { display:grid; gap:7px; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    input { width:100%; border:1px solid var(--line); background:#090c0a; color:var(--ink); padding:12px; outline:none; }
    input:focus { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
    .button { border:1px solid var(--line); color:var(--ink); background:#202620; padding:10px 14px; text-transform:uppercase; letter-spacing:.06em; }
    .button:hover { border-color:var(--accent); }
    .button.primary { color:#0a0c09; border-color:var(--accent); background:var(--accent); font-weight:800; }
    .button.danger { border-color:#6f332a; color:#ff9b8b; }
    .button.small { padding:6px 9px; font-size:11px; }
    .toolbar { display:flex; flex-wrap:wrap; gap:9px; align-items:center; }
    .toolbar input { width:min(340px,100%); }
    .dashboard { display:grid; gap:18px; margin-top:22px; }
    .metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .metric,.panel { border:1px solid var(--line); background:rgba(21,25,22,.94); }
    .metric { padding:18px; }
    .metric b { display:block; margin-top:5px; color:var(--accent); font:700 32px/1 system-ui,sans-serif; }
    .panel { padding:18px; overflow:hidden; }
    .panel-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
    .table-wrap { overflow:auto; }
    table { width:100%; border-collapse:collapse; min-width:760px; }
    th,td { text-align:left; border-top:1px solid var(--line); padding:10px 8px; white-space:nowrap; }
    th { color:var(--muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
    .tag { display:inline-block; border:1px solid var(--line); padding:2px 6px; color:var(--blue); }
    .tag.off { color:var(--danger); border-color:#6f332a; }
    .split { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    .hidden { display:none !important; }
    .hint { margin-top:10px; color:var(--muted); font-size:12px; }
    .switch { display:flex; align-items:center; gap:12px; color:var(--ink); font-size:13px; text-transform:none; letter-spacing:0; }
    .switch input { width:auto; accent-color:var(--accent); }
    #turnstile { min-height:0; }
    @media (max-width:800px) { .metrics,.split { grid-template-columns:1fr; } .topbar,.panel-head { align-items:stretch; flex-direction:column; } .panel-head .toolbar { width:100%; } .shell { width:min(100% - 20px,1400px); } }
  </style>
  ${turnstileScript}
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div><div class="eyebrow">LAST LINE / CONTROL</div><h1>管理终端</h1></div>
      <div class="toolbar"><span id="operator" class="status"></span><button id="logout" class="button hidden">退出</button></div>
    </header>

    <section id="auth" class="auth">
      <div class="eyebrow" id="auth-mode">SECURE ACCESS</div>
      <h2 id="auth-title">管理员登录</h2>
      <p class="hint" id="auth-hint">使用独立管理员账号进入控制台。</p>
      <form id="auth-form">
        <label id="bootstrap-field" class="hidden">Bootstrap Token<input id="bootstrap-token" type="password" autocomplete="off" /></label>
        <label id="reset-field" class="hidden">Reset Token<input id="reset-token" type="password" autocomplete="off" /></label>
        <label id="username-field">管理员账号<input id="username" required minlength="3" maxlength="20" autocomplete="username" /></label>
        <label><span id="password-label">密码</span><input id="password" type="password" required minlength="6" maxlength="128" autocomplete="current-password" /></label>
        <div id="turnstile"></div>
        <button class="button primary" type="submit">验证并进入</button>
        <button id="reset-mode" class="button hidden" type="button">忘记密码</button>
        <p id="auth-status" class="status" role="status"></p>
      </form>
    </section>

    <section id="dashboard" class="dashboard hidden">
      <div class="metrics">
        <div class="metric"><span>PLAYER ACCOUNTS</span><b id="account-count">0</b></div>
        <div class="metric"><span>ONLINE ROOMS</span><b id="room-count">0</b></div>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>联机准入</h2><span id="auth-policy-state" class="status"></span></div>
        <label class="switch"><input id="auth-required" type="checkbox" />要求玩家注册并登录后才能进入联机大厅</label>
        <p class="hint">关闭时保持游客模式；切换只影响新建联机身份，不会中断已经进入房间的玩家。</p>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>玩家账号</h2><div class="toolbar"><input id="account-search" placeholder="搜索用户名或昵称" /><button id="search-accounts" class="button">搜索</button></div></div>
        <div class="table-wrap"><table><thead><tr><th>用户名</th><th>昵称</th><th>状态</th><th>会话</th><th>创建时间</th><th>操作</th></tr></thead><tbody id="accounts"></tbody></table></div>
        <div class="toolbar"><button id="accounts-prev" class="button small">上一页</button><span id="accounts-range" class="status"></span><button id="accounts-next" class="button small">下一页</button></div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>在线房间</h2><button id="refresh-rooms" class="button">刷新</button></div>
        <div class="table-wrap"><table><thead><tr><th>房间码</th><th>类型</th><th>房主</th><th>人数</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody id="rooms"></tbody></table></div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>修改管理员密码</h2></div>
        <form id="change-password" class="stack">
          <label>当前密码<input id="current-password" type="password" required /></label>
          <label>新密码<input id="new-password" type="password" required minlength="12" maxlength="128" /></label>
          <button class="button" type="submit">更新并撤销其他会话</button>
        </form>
      </section>
      <p id="dashboard-status" class="status" role="status"></p>
    </section>
  </main>
  <script nonce="${nonce}">
    "use strict";
    const turnstileSiteKey = ${safeJson(turnstileSiteKey)};
    const state = { authMode: "login", resetConfigured: false, turnstileToken: "", widgetId: null, accountOffset: 0, accountTotal: 0 };
    const byId = (id) => document.getElementById(id);

    window.addEventListener("load", () => { void initialize(); });

    async function initialize() {
      bindEvents();
      try {
        const status = await api("/v1/admin/status");
        configureAuth(status);
        if (status.administrator) await showDashboard(status.administrator);
      } catch (error) {
        showAuthError(error);
      }
    }

    function configureAuth(status) {
      state.authMode = status.needsBootstrap ? "bootstrap" : "login";
      state.resetConfigured = status.resetConfigured;
      applyAuthMode(status.bootstrapConfigured, status.turnstile.enabled);
    }

    function applyAuthMode(bootstrapConfigured = true, turnstileEnabled = Boolean(turnstileSiteKey)) {
      const mode = state.authMode;
      byId("bootstrap-field").classList.toggle("hidden", mode !== "bootstrap");
      byId("reset-field").classList.toggle("hidden", mode !== "reset");
      byId("username-field").classList.remove("hidden");
      byId("username").required = true;
      byId("password-label").textContent = mode === "reset" ? "新密码" : "密码";
      byId("auth-title").textContent = mode === "bootstrap" ? "初始化管理员" : mode === "reset" ? "重置管理员密码" : "管理员登录";
      byId("auth-hint").textContent = mode === "bootstrap"
        ? bootstrapConfigured ? "输入一次性 Bootstrap Token 并设置管理员账号。" : "服务端尚未配置 Bootstrap Token。"
        : mode === "reset"
          ? "输入临时 ADMIN_RESET_TOKEN 并设置新密码，成功后立即删除该 Secret。"
          : "使用管理员账号进入控制台。";
      byId("reset-mode").classList.toggle("hidden", mode === "bootstrap" || !state.resetConfigured);
      byId("reset-mode").textContent = mode === "reset" ? "返回登录" : "忘记密码";
      if (turnstileEnabled) renderTurnstile(mode === "bootstrap" ? "admin_bootstrap" : mode === "reset" ? "admin_reset" : "admin_login");
    }

    function renderTurnstile(action) {
      if (!turnstileSiteKey || !window.turnstile) return;
      state.turnstileToken = "";
      if (state.widgetId !== null) window.turnstile.remove(state.widgetId);
      state.widgetId = window.turnstile.render("#turnstile", {
        sitekey: turnstileSiteKey,
        action,
        callback: (token) => { state.turnstileToken = token; },
        "expired-callback": () => { state.turnstileToken = ""; },
        "timeout-callback": () => { state.turnstileToken = ""; },
        "error-callback": () => { state.turnstileToken = ""; },
      });
    }

    function resetTurnstile() {
      state.turnstileToken = "";
      if (state.widgetId !== null && window.turnstile) window.turnstile.reset(state.widgetId);
    }

    function bindEvents() {
      byId("auth-form").addEventListener("submit", (event) => { event.preventDefault(); void authenticate(); });
      byId("reset-mode").addEventListener("click", () => { state.authMode = state.authMode === "reset" ? "login" : "reset"; applyAuthMode(); });
      byId("logout").addEventListener("click", () => { void logout(); });
      byId("search-accounts").addEventListener("click", () => { state.accountOffset = 0; void loadAccounts(); });
      byId("account-search").addEventListener("keydown", (event) => { if (event.key === "Enter") { state.accountOffset = 0; void loadAccounts(); } });
      byId("accounts-prev").addEventListener("click", () => { state.accountOffset = Math.max(0, state.accountOffset - 100); void loadAccounts(); });
      byId("accounts-next").addEventListener("click", () => { if (state.accountOffset + 100 < state.accountTotal) { state.accountOffset += 100; void loadAccounts(); } });
      byId("refresh-rooms").addEventListener("click", () => { void loadRooms(); });
      byId("auth-required").addEventListener("change", () => { void updateAuthPolicy(); });
      byId("change-password").addEventListener("submit", (event) => { event.preventDefault(); void changePassword(); });
      byId("accounts").addEventListener("click", (event) => { void handleAccountAction(event); });
      byId("rooms").addEventListener("click", (event) => { void handleRoomAction(event); });
    }

    async function authenticate() {
      setStatus("auth-status", "正在验证…");
      const mode = state.authMode;
      const body = mode === "reset"
        ? { username: byId("username").value, resetToken: byId("reset-token").value, newPassword: byId("password").value, turnstileToken: state.turnstileToken }
        : { username: byId("username").value, password: byId("password").value, turnstileToken: state.turnstileToken };
      if (mode === "bootstrap") body.bootstrapToken = byId("bootstrap-token").value;
      try {
        const endpoint = mode === "bootstrap" ? "/v1/admin/bootstrap" : mode === "reset" ? "/v1/admin/reset" : "/v1/admin/login";
        const value = await api(endpoint, body);
        byId("password").value = "";
        await showDashboard(value.administrator);
      } catch (error) {
        setStatus("auth-status", error.message, true);
        resetTurnstile();
      }
    }

    async function showDashboard(administrator) {
      byId("operator").textContent = "OPERATOR / " + administrator.username;
      byId("logout").classList.remove("hidden");
      byId("auth").classList.add("hidden");
      byId("dashboard").classList.remove("hidden");
      await Promise.all([loadAccounts(), loadRooms(), loadSettings()]);
    }

    async function loadSettings() {
      const value = await api("/v1/admin/settings");
      byId("auth-required").checked = value.registrationLoginRequired;
      byId("auth-policy-state").textContent = value.registrationLoginRequired ? "强制账号" : "游客模式";
    }

    async function updateAuthPolicy() {
      const checkbox = byId("auth-required");
      checkbox.disabled = true;
      try {
        const value = await api("/v1/admin/settings/auth", { required: checkbox.checked });
        checkbox.checked = value.registrationLoginRequired;
        byId("auth-policy-state").textContent = value.registrationLoginRequired ? "强制账号" : "游客模式";
        setStatus("dashboard-status", value.registrationLoginRequired ? "新玩家现在必须注册或登录" : "已恢复游客联机");
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        setStatus("dashboard-status", error.message, true);
      } finally {
        checkbox.disabled = false;
      }
    }

    async function loadAccounts() {
      const query = encodeURIComponent(byId("account-search").value.trim());
      const value = await api("/v1/admin/accounts?q=" + query + "&limit=100&offset=" + state.accountOffset);
      state.accountTotal = value.total;
      byId("account-count").textContent = String(value.total);
      const end = Math.min(value.total, state.accountOffset + value.accounts.length);
      byId("accounts-range").textContent = value.total ? (state.accountOffset + 1) + "–" + end + " / " + value.total : "0 / 0";
      byId("accounts-prev").disabled = state.accountOffset === 0;
      byId("accounts-next").disabled = state.accountOffset + 100 >= value.total;
      const body = byId("accounts"); body.replaceChildren();
      for (const account of value.accounts) {
        const actions = document.createElement("div"); actions.className = "toolbar";
        actions.append(actionButton(account.disabledAt ? "恢复" : "禁用", account.disabledAt ? "enable" : "disable", account.id, account.disabledAt ? "" : "danger"));
        actions.append(actionButton("撤销会话", "revoke", account.id));
        appendRow(body, [account.username, account.displayName, tag(account.disabledAt ? "已禁用" : "正常", Boolean(account.disabledAt)), String(account.activeSessions), formatTime(account.createdAt), actions]);
      }
    }

    async function handleAccountAction(event) {
      const button = event.target.closest("button[data-action]"); if (!button) return;
      const action = button.dataset.action; const id = button.dataset.id;
      if (action === "disable" && !confirm("确认禁用该账号并撤销全部会话？")) return;
      try { await api("/v1/admin/accounts/" + encodeURIComponent(id) + "/" + action, {}); await loadAccounts(); setStatus("dashboard-status", "账号操作已完成"); }
      catch (error) { setStatus("dashboard-status", error.message, true); }
    }

    async function loadRooms() {
      const value = await api("/v1/admin/rooms");
      byId("room-count").textContent = String(value.rooms.length);
      const body = byId("rooms"); body.replaceChildren();
      for (const room of value.rooms) {
        const actions = actionButton("关闭", "close", room.roomId, "danger");
        appendRow(body, [room.code, room.visibility === "private" ? "私人" : "公开", room.hostName, room.playerCount + "/" + room.capacity, tag(room.status, false), formatTime(room.updatedAt), actions]);
      }
    }

    async function handleRoomAction(event) {
      const button = event.target.closest("button[data-action='close']"); if (!button) return;
      if (!confirm("确认强制关闭该房间？房内连接会立即断开。")) return;
      try { await api("/v1/admin/rooms/" + encodeURIComponent(button.dataset.id) + "/close", {}); await loadRooms(); setStatus("dashboard-status", "房间已关闭"); }
      catch (error) { setStatus("dashboard-status", error.message, true); }
    }

    async function changePassword() {
      try {
        const value = await api("/v1/admin/password", { currentPassword: byId("current-password").value, newPassword: byId("new-password").value });
        byId("current-password").value = ""; byId("new-password").value = "";
        setStatus("dashboard-status", "密码已更新，其他会话已撤销");
      } catch (error) { setStatus("dashboard-status", error.message, true); }
    }

    async function logout() {
      await api("/v1/admin/logout", {}, true);
      location.reload();
    }

    async function api(path, body, allowUnauthorized = false, method) {
      const response = await fetch(path, {
        method: method || (body === undefined ? "GET" : "POST"),
        credentials: "same-origin",
        headers: body === undefined || body === null ? {} : { "Content-Type": "application/json" },
        body: body === undefined || body === null ? undefined : JSON.stringify(body),
      });
      if (allowUnauthorized && response.status === 401) return null;
      const value = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorLabel(value.error));
      return value;
    }

    function appendRow(parent, values) { const row = document.createElement("tr"); for (const value of values) { const cell = document.createElement("td"); if (value instanceof Node) cell.append(value); else cell.textContent = String(value); row.append(cell); } parent.append(row); }
    function actionButton(label, action, id, kind = "") { const button = document.createElement("button"); button.type = "button"; button.className = "button small " + kind; button.textContent = label; button.dataset.action = action; button.dataset.id = id; return button; }
    function tag(label, disabled) { const span = document.createElement("span"); span.className = "tag" + (disabled ? " off" : ""); span.textContent = label; return span; }
    function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12:false }) : "-"; }
    function setStatus(id, message, bad = false) { const node = byId(id); node.textContent = message; node.classList.toggle("bad", bad); }
    function showAuthError(error) { setStatus("auth-status", error.message || "管理服务不可用", true); }
    function errorLabel(code) { return ({ unauthorized:"登录已失效", forbidden:"请求来源无效", "invalid-credentials":"账号或密码错误", "invalid-bootstrap":"Bootstrap Token 或账号信息无效", "bootstrap-complete":"管理员初始化已完成", "invalid-reset":"Reset Token 或新密码无效", "reset-unavailable":"密码恢复当前不可用", "turnstile-failed":"机器验证失败", "rate-limited":"请求过于频繁", "account-not-found":"账号不存在", "room-not-found":"房间不存在" })[code] || code || "请求失败"; }
  </script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeJson(value: string | null): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
