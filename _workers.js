// V3.2.9 配色優化版：
// 1. UI 優化：ITDog 按鈕改為 "深粉紅色" (Deep Pink)，解決顏色太淺看不清的問題
// 2. 保持 V3.2.7 的精簡儀表板與 V3.2.6 的 API 修復

// --- 設定區域 ---
const FAST_IP_COUNT = 25; // 優質 IP 數量
const AUTO_TEST_MAX_IPS = 500; // 測速最大數量

// IP 來源網址列表
const CIDR_SOURCE_URLS = [
    'https://raw.githubusercontent.com/cmliu/cmliu/refs/heads/main/CF-CIDR.txt'
];
// ----------------

export default {
    async scheduled(event, env, ctx) {
      ctx.waitUntil(handleScheduled(env));
    },
  
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const path = url.pathname;
      const hostname = url.hostname.toLowerCase();
      
      if (!env.IP_STORAGE) return new Response('錯誤：KV 未綁定', {status: 500});
      if (request.method === 'OPTIONS') return handleCORS();

      try {
        // --- 1. 子域名路由 (公開) ---
        if (hostname.startsWith('fast.') || hostname.startsWith('fast-')) return await handleGetFastIPsText(env, request);
        if (hostname.startsWith('browser.') || hostname.startsWith('web.')) return await handleGetBrowserIPsText(env, request);
        if (hostname.startsWith('all.') || hostname.startsWith('ips.') || hostname.startsWith('raw.')) return await handleGetIPs(env, request);

        // --- 2. 主路由 ---
        switch (path) {
          case '/': return await serveHTML(env, request);
          
          case '/update': if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405); return await handleUpdate(env, request); 
          case '/upload-results': if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405); return await handleUploadResults(env, request);
          
          case '/ips': return await handleGetIPs(env, request);
          case '/ip.txt': return await handleGetIPs(env, request);
          case '/raw': return await handleRawIPs(env, request);
          case '/fast-ips': return await handleGetFastIPs(env, request);
          case '/fast-ips.txt': return await handleGetFastIPsText(env, request);
          case '/browser-ips.txt': return await handleGetBrowserIPsText(env, request);
          case '/speedtest': return await handleSpeedTest(request, env);
          case '/itdog-data': return await handleItdogData(env, request);
          
          case '/my-ip': return handleUserIP(request);

          case '/admin-login': return await handleAdminLogin(request, env);
          case '/admin-status': return await handleAdminStatus(env);
          case '/admin-logout': return await handleAdminLogout(env);
          case '/admin-token': return await handleAdminToken(request, env);
          
          default: return jsonResponse({ error: 'Endpoint not found' }, 404);
        }
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }
  };

  async function handleScheduled(env) {
      const { uniqueIPs, results } = await updateAllIPs(env);
      await env.IP_STORAGE.put('cloudflare_ips', JSON.stringify({ ips: uniqueIPs, lastUpdated: new Date().toISOString(), count: uniqueIPs.length, sources: results }));
      await autoSpeedTestAndStore(env, uniqueIPs);
  }

  function addAuthToUrl(url, sessionId, tokenConfig) {
    if (!sessionId && !tokenConfig) return url;
    const separator = url.includes('?') ? '&' : '?';
    if (tokenConfig && tokenConfig.token) return `${url}${separator}token=${encodeURIComponent(tokenConfig.token)}`;
    if (sessionId) return `${url}${separator}session=${encodeURIComponent(sessionId)}`;
    return url;
  }

  // --- HTML 生成 ---
  async function serveHTML(env, request) {
    const isLoggedIn = await verifyAdmin(request, env);
    const hasAdminPassword = !!env.ADMIN_PASSWORD;
    const tokenConfig = await getTokenConfig(env);
    
    let data = { count: 0, lastUpdated: null };
    let fastIPs = [];
    if (isLoggedIn) {
        data = await getStoredIPs(env);
        const speedData = await getStoredSpeedIPs(env);
        fastIPs = speedData.fastIPs || [];
    }
    
    let sessionId = null;
    if (isLoggedIn) {
      const url = new URL(request.url);
      sessionId = url.searchParams.get('session');
    }

    const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare 優選 IP 測速平台 (V3.2.9)</title>
    <style>
        :root { --primary: #3b82f6; --bg-card: #ffffff; --bg-inner: #f8fafc; --border: #e2e8f0; --text-main: #334155; --text-sub: #64748b; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; line-height: 1.6; background: #f1f5f9; color: var(--text-main); padding: 20px; }
        .container { max-width: 1300px; margin: 0 auto; }
        
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
        .header h1 { font-size: 2rem; color: var(--primary); font-weight: 800; }
        .social-link { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; text-decoration: none; color: var(--text-sub); background: white; font-size: 0.9rem; transition: .2s; }
        .social-link:hover { color: var(--primary); border-color: var(--primary); }

        .card { background: var(--bg-card); border-radius: 16px; padding: 24px; margin-bottom: 24px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .card h2 { font-size: 1.25rem; color: #1e293b; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-weight: 700; }
        
        /* 延遲測試網格 */
        .latency-section { margin-top: 5px; }
        .latency-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
        .latency-box { background: var(--bg-inner); border: 1px solid var(--border); border-radius: 8px; padding: 12px 15px; display: flex; justify-content: space-between; align-items: center; transition: .2s; }
        
        .lat-label { font-size: 0.9rem; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 8px; }
        .lat-ms { font-family: monospace; font-weight: 700; font-size: 1.05rem; }
        .ms-fast { color: #16a34a; } .ms-mid { color: #d97706; } .ms-slow { color: #dc2626; } .ms-err { color: #94a3b8; }

        @media (max-width: 1024px) { .latency-row { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 600px) { .latency-row { grid-template-columns: 1fr; gap: 10px; } .header { flex-direction: column; text-align: center; gap: 10px; } }

        /* 統計與按鈕 */
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .stat { background: var(--bg-inner); padding: 16px; border-radius: 12px; text-align: center; border: 1px solid var(--border); }
        .stat-value { font-size: 1.8rem; font-weight: 700; color: var(--primary); }
        
        .button-group { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
        .button { padding: 10px 18px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; background: var(--primary); color: white; display: inline-flex; align-items: center; gap: 6px; font-size: 0.95rem; text-decoration: none; height: 42px; }
        .button:hover { background: #2563eb; transform: translateY(-1px); }
        .button:disabled { opacity: 0.6; cursor: not-allowed; }
        
        /* 按鈕顏色定義 */
        .button-success { background: #10b981; } .button-success:hover { background: #059669; }
        .button-secondary { background: white; color: #475569; border: 1px solid #cbd5e1; } .button-secondary:hover { background: #f1f5f9; }
        .button-purple { background: #8b5cf6; } .button-purple:hover { background: #7c3aed; }
        .button-warning { background: #f59e0b; } .button-warning:hover { background: #d97706; }
        /* 新增：深粉色 ITDog 按鈕 */
        .button-pink { background: #db2777; } .button-pink:hover { background: #be185d; }
        .button-slate { background: #64748b; } .button-slate:hover { background: #475569; }

        .ip-list { max-height: 500px; overflow-y: auto; border: 1px solid var(--border); border-radius: 12px; }
        .ip-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); background: white; }
        .ip-info { display: flex; align-items: center; gap: 12px; }
        .ip-address { font-family: monospace; font-weight: 600; font-size: 1.05rem; min-width: 140px; }
        .colo-badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: #e0e7ff; color: #4338ca; font-weight: 600; min-width: 45px; text-align: center; }
        .speed-result { font-size: 0.85rem; padding: 4px 10px; border-radius: 6px; background: var(--bg-inner); min-width: 70px; text-align: center; font-weight: 600; }
        .speed-fast-bg { background: #dcfce7; color: #166534; } 
        
        .dropdown { position: relative; display: inline-block; }
        .dropdown-content { display: none; position: absolute; background-color: white; min-width: 230px; box-shadow: 0 8px 16px rgba(0,0,0,0.1); z-index: 10; border-radius: 8px; border: 1px solid var(--border); top: 100%; left: 0; }
        .dropdown:hover .dropdown-content { display: block; }
        .dropdown-content a { color: #333; padding: 12px 16px; text-decoration: none; display: block; font-size: 0.9rem; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
        .dropdown-content a:hover { background: var(--bg-inner); color: #2563eb; }

        .port-box { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .port-tag { padding: 4px 10px; border-radius: 6px; font-family: monospace; font-size: 0.95rem; border: 1px solid transparent; font-weight: 600; }
        .tag-http { background: #fff1f2; color: #be123c; border-color: #fda4af; } .tag-https { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }

        .log-box { background: #1e293b; color: #10b981; font-family: monospace; font-size: 0.85rem; padding: 15px; border-radius: 12px; margin-top: 20px; height: 200px; overflow-y: auto; border: 1px solid #334155; display: none; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); backdrop-filter: blur(2px); z-index: 1000; justify-content: center; align-items: center; }
        .modal-content { background: white; padding: 24px; border-radius: 16px; width: 90%; max-width: 450px; }
        .admin-indicator { position: fixed; top: 20px; right: 20px; z-index: 900; }
        .admin-badge { background: #10b981; color: white; padding: 8px 16px; border-radius: 20px; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .admin-badge.logged-out { background: #ef4444; }
        .progress-bar { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin: 10px 0; display: none; }
        .progress-fill { height: 100%; background: #3b82f6; width: 0%; transition: width 0.3s; }
    </style>
</head>
<body>
    <div class="admin-indicator">
        <div class="admin-badge ${isLoggedIn ? '' : 'logged-out'}" onclick="${isLoggedIn ? 'logout()' : ''}" id="admin-badge">${isLoggedIn ? '🔐 管理員' : '🔒 未登入'}</div>
        ${isLoggedIn ? `<div class="dropdown-content" id="admin-dropdown" style="display:none; position:absolute; right:0;"><a onclick="logout()">退出登入</a></div>` : ''}
    </div>

    <div class="container">
        <div class="header">
            <div class="header-content"><h1>Cloudflare 優選 IP 測速平台</h1><p>V3.2.9</p></div>
            <div><a href="https://github.com/sammy0101/CF-Worker-BestIP-collector" target="_blank" class="social-link">GitHub</a></div>
        </div>

        <!-- 儀表板區域 (精簡版：僅保留連通性測試) -->
        <div class="card">
            <h2>🌍 當前網絡信息 <span style="font-size:0.8rem; color:#94a3b8; font-weight:400; margin-left:10px;">(每5秒自動刷新)</span></h2>
            
            <div class="latency-section">
                <div style="font-size:0.85rem; font-weight:700; color:#64748b; margin-bottom:8px;">HTTP 連通性測試 - 國外</div>
                <div class="latency-row">
                    <div class="latency-box"><div class="lat-label">🐙 GitHub</div><div class="lat-ms ms-err" id="lat-github">---</div></div>
                    <div class="latency-box"><div class="lat-label">🤖 OpenAI</div><div class="lat-ms ms-err" id="lat-openai">---</div></div>
                    <div class="latency-box"><div class="lat-label">☁️ Cloudflare</div><div class="lat-ms ms-err" id="lat-cf">---</div></div>
                    <div class="latency-box"><div class="lat-label">▶️ YouTube</div><div class="lat-ms ms-err" id="lat-youtube">---</div></div>
                </div>

                <div style="font-size:0.85rem; font-weight:700; color:#64748b; margin-bottom:8px;">HTTP 連通性測試 - 國內</div>
                <div class="latency-row">
                    <div class="latency-box"><div class="lat-label">🐼 百度</div><div class="lat-ms ms-err" id="lat-baidu">---</div></div>
                    <div class="latency-box"><div class="lat-label">📺 Bilibili</div><div class="lat-ms ms-err" id="lat-bilibili">---</div></div>
                    <div class="latency-box"><div class="lat-label">💬 微信</div><div class="lat-ms ms-err" id="lat-wechat">---</div></div>
                    <div class="latency-box"><div class="lat-label">🛒 淘寶</div><div class="lat-ms ms-err" id="lat-taobao">---</div></div>
                </div>
            </div>
        </div>

        ${!isLoggedIn ? `
        <!-- 鎖定畫面 -->
        <div class="card lock-screen">
            <div class="lock-icon">🔒</div>
            <h2>系統已鎖定</h2>
            <p style="color:#64748b; margin-bottom:30px;">請輸入管理員密碼以查看與下載數據。</p>
            <input type="password" id="main-pass" class="lock-input" placeholder="輸入管理員密碼"><br>
            <div style="margin-bottom: 20px;"><label style="cursor:pointer; color:#64748b; font-size:0.95rem;"><input type="checkbox" id="remember-pass-main" style="margin-right:6px;">記住密碼</label></div>
            <button class="button" onclick="loginMain()">登入系統</button>
        </div>
        ` : `
        <!-- 主控台 -->
        <div class="card">
            <h2>📊 系統狀態</h2>
            <div class="stats">
                <div class="stat"><div class="stat-value">${data.count || 0}</div><div>IP 總數</div></div>
                <div class="stat"><div class="stat-value">${data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : '從未'}</div><div>更新時間</div></div>
                <div class="stat"><div class="stat-value">${fastIPs.length}</div><div>優質 IP</div></div>
            </div>
            <div class="button-group">
                <button class="button" onclick="updateIPs()" id="update-btn">🔄 立即更新庫</button>
                <button class="button button-warning" onclick="startSpeedTest()" id="speedtest-btn">⚡ 瀏覽器測速</button>
                
                <div class="dropdown"><button class="button button-success">🚀 下載中心 ▼</button>
                    <div class="dropdown-content">
                        <a href="${addAuthToUrl('/fast-ips.txt', sessionId, tokenConfig)}" download="cloudflare_fast_ips.txt">🚀 下載後端優選 IP</a>
                        <a onclick="downloadBrowserResults()">⚡ 下載本機測速結果</a>
                        <a href="${addAuthToUrl('/ips', sessionId, tokenConfig)}" download="all_ips.txt">📦 下載完整 IP 庫</a>
                    </div>
                </div>
                <div class="dropdown"><button class="button button-secondary">📄 線上查看 ▼</button>
                    <div class="dropdown-content">
                        <a href="${addAuthToUrl('/fast-ips.txt', sessionId, tokenConfig)}" target="_blank">🚀 查看後端優選 IP</a>
                        <a href="${addAuthToUrl('/browser-ips.txt', sessionId, tokenConfig)}" target="_blank">⚡ 查看本機測速結果</a>
                        <a href="${addAuthToUrl('/ip.txt', sessionId, tokenConfig)}" target="_blank">📦 查看完整 IP 庫</a>
                    </div>
                </div>
                <div class="dropdown"><button class="button button-purple">🔌 複製 API 連結 ▼</button>
                    <div class="dropdown-content">
                        <a onclick="copyApiUrl('fast')">🚀 複製後端優選 IP API</a>
                        <a onclick="copyApiUrl('browser')">⚡ 複製本機測速結果 API</a>
                        <a onclick="copyApiUrl('all')">📦 複製完整 IP 庫 API</a>
                    </div>
                </div>
                <button class="button button-pink" onclick="openItdogModal()">🌐 ITDog 測速</button>
                <button class="button button-slate" onclick="openTokenModal()">🔑 Token 管理</button>
            </div>
            <div id="log-box" class="log-box"></div>
            ${tokenConfig ? `<div style="margin-top: 15px; padding: 10px; background: #f1f5f9; border-radius: 8px; font-size: 0.85rem;"><strong>當前 Token:</strong> <span style="font-family:monospace; background:white; padding:2px 6px; border-radius:4px;">${tokenConfig.token}</span></div>` : ''}
        </div>

        <!-- 端口資訊 -->
        <div class="card">
            <h2>📡 支援端口資訊</h2>
            <div style="margin-bottom: 20px;">
                <div style="color:#be123c; font-weight:600; margin-bottom:5px;">HTTP 支援端口：</div>
                <div class="port-box"><span class="port-tag tag-http">80</span><span class="port-tag tag-http">8080</span><span class="port-tag tag-http">8880</span><span class="port-tag tag-http">2052</span><span class="port-tag tag-http">2082</span><span class="port-tag tag-http">2086</span><span class="port-tag tag-http">2095</span></div>
            </div>
            <div>
                <div style="color:#1d4ed8; font-weight:600; margin-bottom:5px;">HTTPS 支援端口：</div>
                <div class="port-box"><span class="port-tag tag-https">443</span><span class="port-tag tag-https">2053</span><span class="port-tag tag-https">2083</span><span class="port-tag tag-https">2087</span><span class="port-tag tag-https">2096</span><span class="port-tag tag-https">8443</span></div>
            </div>
        </div>

        <div class="card">
            <div style="display:flex; justify-content:space-between; margin-bottom:15px;"><h2>🏆 優選 IP 列表</h2><button class="small-btn" onclick="copyAllFastIPs()">📋 複製所有 IP</button></div>
            <div class="progress-bar" id="progress"><div class="progress-fill" id="progress-fill"></div></div>
            <div id="status-text" style="text-align:center; font-size:0.85rem; color:#64748b; margin-bottom:10px;"></div>
            <div class="ip-list" id="ip-list">
                ${fastIPs.length > 0 ? fastIPs.map(item => {
                    const speedClass = item.latency < 200 ? 'speed-fast-bg' : '';
                    const colo = item.colo || 'UNK';
                    const coloStyle = ['HKG', 'SJC', 'LAX', 'TPE'].includes(colo) ? 'background:#dcfce7; color:#166534;' : '';
                    return `<div class="ip-item" data-ip="${item.ip}"><div class="ip-info"><span class="colo-badge" style="${coloStyle}">${colo}</span><span class="ip-address">${item.ip}</span><span class="speed-result ${speedClass}">${item.latency}ms</span></div><button class="small-btn" onclick="copyIP('${item.ip}')">複製</button></div>`;
                }).join('') : '<p style="text-align:center; padding:30px; color:#94a3b8;">暫無數據，請點擊更新</p>'}
            </div>
        </div>
        `}
    </div>

    <!-- Modals -->
    <div class="modal" id="itdog-modal"><div class="modal-content"><h3>🌐 ITDog 測速</h3><p style="margin-bottom:15px;">複製 IP 至 ITDog 測試。</p><div style="text-align:right;"><button class="button button-secondary" onclick="document.getElementById('itdog-modal').style.display='none'">關閉</button><button class="button" onclick="copyIPsForItdog()">📋 複製前往</button></div></div></div>
    <div class="modal" id="login-modal"><div class="modal-content"><h3>🔐 管理員登入</h3><input type="password" id="admin-pass" placeholder="密碼" style="width:100%; padding:10px; margin:15px 0;"><button class="button" onclick="loginModal()">登入</button></div></div>
    <div class="modal" id="token-modal"><div class="modal-content"><h3>⚙️ Token 設定</h3><input type="text" id="token-in" placeholder="Token" style="width:100%; padding:10px; margin:10px 0;"><div style="text-align:right;"><button class="button button-secondary" onclick="document.getElementById('token-modal').style.display='none'">取消</button><button class="button" onclick="saveToken()">儲存</button></div></div></div>

    <script>
        let sessionId = '${sessionId || ''}';
        let isLoggedIn = ${isLoggedIn};
        let tokenConfig = ${tokenConfig ? JSON.stringify(tokenConfig) : 'null'};
        const MAX_TEST = ${AUTO_TEST_MAX_IPS};
        const DISPLAY_COUNT = ${FAST_IP_COUNT};

        document.addEventListener('DOMContentLoaded', function() {
            initDashboard();
            setInterval(initDashboard, 5000); 
            
            if (!isLoggedIn) {
                const savedPass = localStorage.getItem('cf_admin_pass');
                if (savedPass) { document.getElementById('main-pass').value = savedPass; document.getElementById('remember-pass-main').checked = true; }
            }
            document.querySelectorAll('input[type=password]').forEach(el => el.addEventListener('keypress', e => { if(e.key==='Enter') isLoggedIn ? loginModal() : loginMain(); }));
        });

        // === 儀表板邏輯 ===
        function initDashboard() {
            // 延遲測試
            checkLatency('https://github.githubassets.com/favicons/favicon.svg', 'lat-github');
            checkLatency('https://openai.com/favicon.ico', 'lat-openai');
            checkLatency('https://www.cloudflare.com/favicon.ico', 'lat-cf');
            checkLatency('https://www.youtube.com/favicon.ico', 'lat-youtube');
            checkLatency('https://www.baidu.com/favicon.ico', 'lat-baidu');
            checkLatency('https://www.bilibili.com/favicon.ico', 'lat-bilibili');
            checkLatency('https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico', 'lat-wechat');
            checkLatency('https://www.taobao.com/favicon.ico', 'lat-taobao');
        }

        async function checkLatency(url, elId) {
            const el = document.getElementById(elId);
            const start = Date.now();
            const img = new Image();
            const timeout = setTimeout(() => { el.innerText = '超時'; el.className = 'lat-ms ms-slow'; }, 5000);
            img.onload = img.onerror = function() {
                clearTimeout(timeout);
                const ping = Date.now() - start;
                el.innerText = ping + 'ms';
                el.className = 'lat-ms ' + (ping < 100 ? 'ms-fast' : ping < 300 ? 'ms-mid' : 'ms-slow');
            };
            img.src = url + '?' + Math.random();
        }

        // === 既有邏輯 (保持不變) ===
        function addLog(msg, type='normal') {
            const box = document.getElementById('log-box'); if(!box) return; box.style.display='block';
            box.innerHTML += \`<div class="log-line \${type==='error'?'log-error':type==='info'?'log-info':''}">[\${new Date().toLocaleTimeString()}] \${msg}</div>\`;
            box.scrollTop = box.scrollHeight;
        }
        function clearLog() { const box = document.getElementById('log-box'); if(box) box.innerHTML = ''; }

        async function api(path, method='GET', body=null) {
            const headers = { 'Content-Type': 'application/json' };
            if (sessionId) headers['Authorization'] = 'Bearer ' + sessionId;
            else if (tokenConfig) headers['Authorization'] = 'Token ' + tokenConfig.token;
            const opts = { method, headers };
            if (body) opts.body = JSON.stringify(body);
            let url = path + (method==='GET' && (sessionId||tokenConfig) ? (path.includes('?')?'&':'?') + (tokenConfig ? 'token='+tokenConfig.token : 'session='+sessionId) : '');
            return (await fetch(url, opts)).json();
        }

        async function loginMain() { performLogin(document.getElementById('main-pass').value, document.getElementById('remember-pass-main').checked); }
        async function loginModal() { performLogin(document.getElementById('admin-pass').value, true); }
        async function performLogin(password, remember) {
            if(!password) return alert('請輸入密碼');
            const res = await api('/admin-login', 'POST', {password});
            if(res.success) {
                if(remember) localStorage.setItem('cf_admin_pass', password); else localStorage.removeItem('cf_admin_pass');
                const url = new URL(window.location.href); url.searchParams.set('session', res.sessionId); window.location.href = url.toString();
            } else alert(res.error);
        }
        async function logout() { await api('/admin-logout', 'POST'); const url = new URL(window.location.href); url.searchParams.delete('session'); window.location.href = url.toString(); }

        async function updateIPs() {
            const btn = document.getElementById('update-btn'); btn.disabled = true; btn.innerText = '更新中...';
            clearLog(); addLog('🚀 後端更新中...', 'info');
            try { const res = await api('/update', 'POST'); if(res.success) { addLog('✅ 成功'); setTimeout(()=>location.reload(), 2000); } else addLog('❌ '+res.error, 'error'); } catch(e) { addLog('❌ '+e.message, 'error'); }
            btn.disabled = false; btn.innerText = '🔄 立即更新庫';
        }

        async function startSpeedTest() {
            const allIpElements = document.querySelectorAll('.ip-item');
            let allIps = [];
            try { const res = await api('/raw'); allIps = res.ips && res.ips.length ? res.ips : []; } catch(e) {}
            if(!allIps.length) allIps = Array.from(allIpElements).map(el => el.dataset.ip);
            if(!allIps.length) return addLog('❌ 無 IP', 'error');

            clearLog(); addLog(\`🚀 測速開始 (\${allIps.length} IPs)\`, 'info');
            for (let i = allIps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [allIps[i], allIps[j]] = [allIps[j], allIps[i]]; }
            const targets = allIps.slice(0, MAX_TEST);
            
            document.getElementById('progress').style.display = 'block';
            let count = 0, results = [];
            for(const ip of targets) {
                document.getElementById('status-text').innerText = \`測試 \${ip} (\${count+1}/\${targets.length})\`;
                try {
                    const start = performance.now();
                    const controller = new AbortController();
                    setTimeout(() => controller.abort(), 2000);
                    const res = await fetch(\`/speedtest?ip=\${ip}\`, { signal: controller.signal });
                    const data = await res.json();
                    const lat = Math.round(performance.now() - start);
                    if(data.success) {
                        addLog(\`✅ [\${data.colo}] \${ip} - \${lat}ms\`, lat<200?'info':'normal');
                        results.push({ip, latency: lat, colo: data.colo || 'UNK'});
                    }
                } catch(e) {}
                count++;
                document.getElementById('progress-fill').style.width = (count/targets.length*100) + '%';
                await new Promise(r => setTimeout(r, 50));
            }
            if(results.length) {
                results.sort((a,b) => a.latency - b.latency);
                const topResults = results.slice(0, DISPLAY_COUNT);
                let newHtml = '';
                topResults.forEach(item => {
                    const coloStyle = ['HKG','SJC','LAX','TPE'].includes(item.colo) ? 'background:#dcfce7;color:#166534;' : '';
                    newHtml += \`<div class="ip-item" data-ip="\${item.ip}"><div class="ip-info"><span class="colo-badge" style="\${coloStyle}">\${item.colo}</span><span class="ip-address">\${item.ip}</span><span class="speed-result">\${item.latency}ms</span></div><button class="small-btn" onclick="copyIP('\${item.ip}')">複製</button></div>\`;
                });
                document.getElementById('ip-list').innerHTML = newHtml;
                try { await api('/upload-results', 'POST', { fastIPs: topResults }); addLog('✅ 結果已上傳'); } catch(e){}
            }
            document.getElementById('progress').style.display = 'none';
        }

        function downloadBrowserResults() {
            const items = document.querySelectorAll('.ip-item');
            if(!items.length) return alert('無數據');
            let txt = ''; items.forEach(i => txt += \`\${i.dataset.ip}#\${i.querySelector('.colo-badge').innerText}:\${i.querySelector('.speed-result').innerText}\\n\`);
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], {type:'text/plain'})); a.download = 'speedtest.txt'; a.click();
        }

        function copyApiUrl(type) {
            const host = window.location.host; const parts = host.split('.');
            let url = parts.length >= 3 ? (parts[0]=type, parts.join('.')) : type+'.'+host;
            navigator.clipboard.writeText(url).then(()=>alert('已複製: '+url));
        }

        function openTokenModal() { document.getElementById('token-modal').style.display='flex'; }
        async function saveToken() {
            const token = document.getElementById('token-in').value;
            const res = await api('/admin-token', 'POST', {token, neverExpire: document.getElementById('never-expire').checked, expiresDays: 30});
            if(res.success) location.reload();
        }
        function copyIP(ip) { navigator.clipboard.writeText(ip); alert('已複製'); }
        function copyAllFastIPs() { 
            const ips = Array.from(document.querySelectorAll('.ip-address')).map(el => el.innerText).join('\\n');
            navigator.clipboard.writeText(ips); alert('已複製');
        }
        function openItdogModal() { document.getElementById('itdog-modal').style.display='flex'; }
        function copyIPsForItdog() {
            const ips = Array.from(document.querySelectorAll('.ip-address')).map(el => el.innerText).join('\\n');
            if(ips) { navigator.clipboard.writeText(ips); window.open('https://www.itdog.cn/batch_tcping/', '_blank'); }
        }
    </script>
</body>
</html>`;
    
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // ---------------- API 處理區 ----------------

  async function handleUpdate(env, request) {
    if (!await verifyAdmin(request, env)) return jsonResponse({ error: '需要權限' }, 401);
    const start = Date.now();
    const { uniqueIPs, results } = await updateAllIPs(env);
    await env.IP_STORAGE.put('cloudflare_ips', JSON.stringify({
      ips: uniqueIPs, lastUpdated: new Date().toISOString(), count: uniqueIPs.length, sources: results
    }));
    return jsonResponse({ success: true, duration: (Date.now()-start)+'ms', totalIPs: uniqueIPs.length });
  }

  async function handleUploadResults(env, request) {
      if (!await verifyAdmin(request, env)) return jsonResponse({ error: '需要權限' }, 401);
      try {
          const { fastIPs } = await request.json();
          if (!fastIPs || !Array.isArray(fastIPs)) return jsonResponse({ error: '無效數據' }, 400);
          await env.IP_STORAGE.put('browser_fast_ips', JSON.stringify({
              fastIPs: fastIPs, lastTested: new Date().toISOString(), count: fastIPs.length, source: 'browser_upload'
          }));
          return jsonResponse({ success: true });
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }

  // 用戶 IP 查詢
  async function handleUserIP(request) {
    const cf = request.cf;
    const ip = request.headers.get('CF-Connecting-IP');
    return jsonResponse({
        ip: ip,
        country: cf ? cf.country : 'UNK',
        city: cf ? cf.city : '',
        asn: cf ? cf.asn : '',
        colo: cf ? cf.colo : ''
    });
  }

  // 數據讀取 (公開)
  async function handleGetFastIPsText(env, request) {
    const url = new URL(request.url);
    const format = url.searchParams.get('format');
    const data = await getStoredSpeedIPs(env);
    const list = data.fastIPs || [];
    let txt = format === 'ip' ? list.map(i => i.ip).join('\n') : list.map(i => `${i.ip}#${i.colo||'UNK'}:${i.latency}ms`).join('\n');
    return new Response(txt, { headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  }

  async function handleGetBrowserIPsText(env, request) {
    const url = new URL(request.url);
    const format = url.searchParams.get('format');
    const data = await getStoredBrowserIPs(env);
    const list = data.fastIPs || [];
    let txt = format === 'ip' ? list.map(i => i.ip).join('\n') : list.map(i => `${i.ip}#${i.colo||'UNK'}:${i.latency}ms`).join('\n');
    return new Response(txt, { headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  }

  async function handleGetFastIPs(env, request) { return jsonResponse(await getStoredSpeedIPs(env)); }
  async function handleGetIPs(env, request) { const d = await getStoredIPs(env); return new Response(d.ips.join('\n'), { headers: {'Content-Type': 'text/plain'} }); }
  async function handleRawIPs(env, request) { return jsonResponse(await getStoredIPs(env)); }
  async function handleItdogData(env, request) { const d = await getStoredSpeedIPs(env); return jsonResponse({ ips: (d.fastIPs||[]).map(i => i.ip) }); }

  async function autoSpeedTestAndStore(env, ips) {
    if (!ips || !ips.length) return null;
    let randomIPs = [...ips];
    for (let i = randomIPs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [randomIPs[i], randomIPs[j]] = [randomIPs[j], randomIPs[i]]; }
    const targets = randomIPs.slice(0, AUTO_TEST_MAX_IPS);
    const results = [];
    const BATCH = 5;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const promises = batch.map(ip => testIPSpeed(ip));
      const outcomes = await Promise.allSettled(promises);
      for (const out of outcomes) { if (out.status === 'fulfilled' && out.value.success) results.push({ ip: out.value.ip, latency: Math.round(out.value.latency), colo: out.value.colo }); }
      if (i + BATCH < targets.length) await new Promise(r => setTimeout(r, 200));
    }
    results.sort((a, b) => a.latency - b.latency);
    const fastIPs = results.slice(0, FAST_IP_COUNT);
    await env.IP_STORAGE.put('cloudflare_fast_ips', JSON.stringify({ fastIPs, lastTested: new Date().toISOString(), count: fastIPs.length, source: 'backend_auto' }));
  }

  // --- 通用函數 ---
  async function handleSpeedTest(request, env) {
    const url = new URL(request.url);
    const ip = url.searchParams.get('ip');
    if (!ip) return jsonResponse({ error: 'IP required' }, 400);
    try {
      const testUrl = `https://speed.cloudflare.com/__down?bytes=1000`;
      const response = await fetch(testUrl, { headers: { 'Host': 'speed.cloudflare.com' }, cf: { resolveOverride: ip }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(response.statusText);
      await response.text(); 
      const ray = response.headers.get('cf-ray');
      return jsonResponse({ success: true, ip, colo: ray ? ray.split('-').pop() : null, time: new Date() });
    } catch (error) { return jsonResponse({ success: false, ip, error: error.message }, 200); }
  }

  async function testIPSpeed(ip) {
    try {
      const start = Date.now();
      const res = await fetch(`https://speed.cloudflare.com/__down?bytes=1000`, { headers: { 'Host': 'speed.cloudflare.com' }, cf: { resolveOverride: ip }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('HTTP Error: ' + res.status + ' ' + res.statusText);
      await res.text();
      const ray = res.headers.get('cf-ray');
      return { success: true, ip, latency: Date.now() - start, colo: ray ? ray.split('-').pop() : null };
    } catch (e) { return { success: false, ip, error: e.message }; }
  }

  async function updateAllIPs(env) {
    const urls = CIDR_SOURCE_URLS;
    const uniqueIPs = new Set();
    const results = [];
    const cidrRegex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?:\/(?:3[0-2]|[1-2]?[0-9]))?\b/gi;
    for (const url of urls) {
        try {
            const txt = await fetchURLWithTimeout(url);
            const matches = txt.match(cidrRegex) || [];
            let count = 0;
            matches.forEach(m => {
                if(m.includes('/')) expandCIDR(m).forEach(ip => { if(isValidIPv4(ip)) { uniqueIPs.add(ip); count++; }});
                else if(isValidIPv4(m)) { uniqueIPs.add(m); count++; }
            });
            results.push({ name: url, status: 'success', count });
        } catch(e) { results.push({ name: url, status: 'error', error: e.message }); }
    }
    return { uniqueIPs: Array.from(uniqueIPs).sort((a,b) => ipToNum(a)-ipToNum(b)), results };
  }

  async function handleAdminLogin(request, env) {
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    try {
      const { password } = await request.json();
      if (!env.ADMIN_PASSWORD) return jsonResponse({ success: false, error: '未設置 ADMIN_PASSWORD' }, 400);
      if (password === env.ADMIN_PASSWORD) {
        let tokenConfig = await getTokenConfig(env);
        if (!tokenConfig) {
          tokenConfig = { token: generateToken(), expires: new Date(Date.now() + 30*24*60*60*1000).toISOString(), createdAt: new Date().toISOString(), lastUsed: null };
          await env.IP_STORAGE.put('token_config', JSON.stringify(tokenConfig));
        }
        const sessionId = generateToken();
        await env.IP_STORAGE.put(`session_${sessionId}`, JSON.stringify({ loggedIn: true, createdAt: new Date().toISOString() }), { expirationTtl: 86400 });
        return jsonResponse({ success: true, sessionId, tokenConfig, message: '登入成功' });
      } else return jsonResponse({ success: false, error: '密碼錯誤' }, 401);
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }

  async function handleAdminToken(request, env) {
    if (!await verifyAdmin(request, env)) return jsonResponse({ error: '需要權限' }, 401);
    if (request.method === 'GET') return jsonResponse({ tokenConfig: await getTokenConfig(env) });
    if (request.method === 'POST') {
        const { token, expiresDays, neverExpire } = await request.json();
        if (!token) return jsonResponse({ error: 'Token不能為空' }, 400);
        let expiresDate = neverExpire ? new Date(Date.now() + 100*365*24*60*60*1000).toISOString() : new Date(Date.now() + expiresDays*24*60*60*1000).toISOString();
        const config = { token: token.trim(), expires: expiresDate, createdAt: new Date().toISOString(), lastUsed: null, neverExpire: neverExpire||false };
        await env.IP_STORAGE.put('token_config', JSON.stringify(config));
        return jsonResponse({ success: true, tokenConfig: config, message: 'Token更新成功' });
    }
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  async function handleAdminStatus(env) { return jsonResponse({ hasAdminPassword: !!env.ADMIN_PASSWORD, hasToken: !!await getTokenConfig(env), tokenConfig: await getTokenConfig(env) }); }
  async function handleAdminLogout(env) { return jsonResponse({ success: true }); }
  async function getTokenConfig(env) { try { return JSON.parse(await env.IP_STORAGE.get('token_config')); } catch { return null; } }
  function generateToken() { let r = ''; const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for(let i=0; i<32; i++) r += c.charAt(Math.floor(Math.random()*c.length)); return r; }
  async function verifyAdmin(request, env) {
    if (!env.ADMIN_PASSWORD) return true;
    try {
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) { if (await env.IP_STORAGE.get(`session_${authHeader.slice(7)}`)) return true; }
      const url = new URL(request.url);
      if (url.searchParams.get('session') && await env.IP_STORAGE.get(`session_${url.searchParams.get('session')}`)) return true;
      const tc = await getTokenConfig(env);
      if (tc) {
        if (!tc.neverExpire && new Date(tc.expires) < new Date()) return false;
        const t = url.searchParams.get('token') || (authHeader && authHeader.startsWith('Token ') ? authHeader.slice(6) : null);
        if (t === tc.token) { tc.lastUsed = new Date().toISOString(); await env.IP_STORAGE.put('token_config', JSON.stringify(tc)); return true; }
      }
      return false;
    } catch { return false; }
  }

  async function getStoredIPs(env) { try { return JSON.parse(await env.IP_STORAGE.get('cloudflare_ips')) || {ips:[]}; } catch { return {ips:[]}; } }
  async function getStoredSpeedIPs(env) { try { return JSON.parse(await env.IP_STORAGE.get('cloudflare_fast_ips')) || {fastIPs:[]}; } catch { return {fastIPs:[]}; } }
  async function getStoredBrowserIPs(env) { try { return JSON.parse(await env.IP_STORAGE.get('browser_fast_ips')) || {fastIPs:[]}; } catch { return {fastIPs:[]}; } }
  
  function expandCIDR(cidr) { try { const [ip, m] = cidr.split('/'); const mask = parseInt(m); if(isNaN(mask)||mask>32) return [ip]; if(mask===32) return [ip]; const start = ipToNum(ip); const len = Math.pow(2, 32-mask); const res = []; for(let i=0; i<(len>256?256:len); i++) res.push(numToIp(start+i)); return res; } catch { return []; } }
  function ipToNum(ip) { return ip.split('.').reduce((a,b) => (a<<8)+parseInt(b),0)>>>0; }
  function numToIp(n) { return [(n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255].join('.'); }
  function isValidIPv4(ip) { return /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip); }
  async function fetchURLWithTimeout(url) { const c = new AbortController(); setTimeout(() => c.abort(), 8000); const res = await fetch(url, { signal: c.signal, headers: {'User-Agent': 'CF-Worker'} }); if(!res.ok) throw new Error('HTTP Error: ' + res.status + ' ' + res.statusText); return await res.text(); }
  function jsonResponse(data, status=200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
  function handleCORS() { return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } }); }
