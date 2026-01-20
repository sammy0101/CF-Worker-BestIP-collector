// V3.1.1 最終優化版：
// 1. 文字微調：ITDog 按鈕與彈窗統一簡化為「🌐 ITDog 測速」
// 2. 保留所有 V3.1.0 核心功能 (雲端同步、Token 查看、獨立存儲)
// 需要到 CF worker 環境變數(Environment Variables)裡添加 ADMIN_PASSWORD

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
      
      if (!env.IP_STORAGE) return new Response('錯誤：KV 未綁定', {status: 500});
      if (request.method === 'OPTIONS') return handleCORS();

      try {
        switch (path) {
          case '/': return await serveHTML(env, request);
          case '/update':
            if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
            return await handleUpdate(env, request); 
          case '/upload-results':
            if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
            return await handleUploadResults(env, request);
          
          // IP 獲取接口
          case '/ips': return await handleGetIPs(env, request);
          case '/ip.txt': return await handleGetIPs(env, request);
          case '/raw': return await handleRawIPs(env, request);
          
          // 優質 IP 接口 (後端自動)
          case '/fast-ips': return await handleGetFastIPs(env, request);
          case '/fast-ips.txt': return await handleGetFastIPsText(env, request);
          
          // 瀏覽器測速結果接口 (前端上傳)
          case '/browser-ips.txt': return await handleGetBrowserIPsText(env, request);

          case '/speedtest': return await handleSpeedTest(request, env);
          case '/itdog-data': return await handleItdogData(env, request);
          
          // 管理員接口
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

  // 定時任務邏輯
  async function handleScheduled(env) {
      const { uniqueIPs, results } = await updateAllIPs(env);
      await env.IP_STORAGE.put('cloudflare_ips', JSON.stringify({
          ips: uniqueIPs, lastUpdated: new Date().toISOString(), count: uniqueIPs.length, sources: results
      }));
      await autoSpeedTestAndStore(env, uniqueIPs);
  }

  function addAuthToUrl(url, sessionId, tokenConfig) {
    if (!sessionId && !tokenConfig) return url;
    const separator = url.includes('?') ? '&' : '?';
    if (tokenConfig && tokenConfig.token) {
        return `${url}${separator}token=${encodeURIComponent(tokenConfig.token)}`;
    }
    if (sessionId) {
        return `${url}${separator}session=${encodeURIComponent(sessionId)}`;
    }
    return url;
  }

  // --- HTML 頁面 ---
  async function serveHTML(env, request) {
    const data = await getStoredIPs(env);
    const speedData = await getStoredSpeedIPs(env); 
    const fastIPs = speedData.fastIPs || [];
    
    const isLoggedIn = await verifyAdmin(request, env);
    const hasAdminPassword = !!env.ADMIN_PASSWORD;
    const tokenConfig = await getTokenConfig(env);
    
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
    <title>Cloudflare 優選 IP 收集器 (V3.1.1)</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; background: #f8fafc; color: #334155; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
        .header h1 { font-size: 2.2rem; background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        
        .social-link { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: 10px; border: 1px solid #e2e8f0; background: white; margin-left: 8px; color: #475569; transition: all 0.3s; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
        .social-link:hover { transform: translateY(-2px); box-shadow: 0 4px 6px rgba(0,0,0,0.05); background: #f8fafc; color: #1e40af; }

        .card { background: white; border-radius: 16px; padding: 24px; margin-bottom: 24px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.02); }
        .card h2 { font-size: 1.4rem; color: #1e40af; margin-bottom: 16px; }
        
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .stat { background: #f8fafc; padding: 16px; border-radius: 12px; text-align: center; border: 1px solid #e2e8f0; }
        .stat-value { font-size: 1.8rem; font-weight: 700; color: #3b82f6; }
        
        .button-group { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; align-items: flex-start; }
        .button { padding: 10px 18px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; background: #3b82f6; color: white; display: inline-flex; align-items: center; gap: 6px; font-size: 0.95rem; text-decoration: none; height: 42px; box-sizing: border-box; }
        .button:hover { background: #2563eb; transform: translateY(-1px); }
        .button:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .button-success { background: #10b981; }
        .button-success:hover { background: #059669; }
        .button-warning { background: #f59e0b; border: 1px solid #f59e0b; }
        .button-warning:hover { background: #d97706; }
        .button-secondary { background: white; color: #475569; border: 1px solid #cbd5e1; }
        .button-secondary:hover { background: #f1f5f9; }
        
        .dropdown { position: relative; display: inline-block; }
        .dropdown-content { 
            display: none; 
            position: absolute; 
            background-color: white; 
            min-width: 190px;
            box-shadow: 0 8px 16px rgba(0,0,0,0.1); 
            z-index: 10; 
            border-radius: 8px; 
            border: 1px solid #e2e8f0; 
            top: 100%;
            left: 0;
            margin-top: 0; 
        }
        .dropdown:hover .dropdown-content { display: block; }
        .dropdown-content a { color: #333; padding: 12px 16px; text-decoration: none; display: block; font-size: 0.9rem; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
        .dropdown-content a:last-child { border-bottom: none; }
        .dropdown-content a:hover { background-color: #f8fafc; color: #2563eb; }

        .ip-list { max-height: 500px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 12px; }
        .ip-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; background: white; }
        .ip-item:hover { background: #f8fafc; }
        
        .ip-info { display: flex; align-items: center; gap: 12px; }
        .ip-address { font-family: monospace; font-weight: 600; font-size: 1.05rem; min-width: 140px; }
        .colo-badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: #e0e7ff; color: #4338ca; font-weight: 600; min-width: 45px; text-align: center; }
        .speed-result { font-size: 0.85rem; padding: 4px 10px; border-radius: 6px; background: #f1f5f9; min-width: 70px; text-align: center; font-weight: 600; }
        .speed-fast { background: #d1fae5; color: #065f46; }
        .speed-medium { background: #fef3c7; color: #92400e; }
        .speed-slow { background: #fee2e2; color: #991b1b; }
        .small-btn { padding: 4px 10px; font-size: 0.8rem; border-radius: 6px; border: 1px solid #cbd5e1; background: white; cursor: pointer; }
        
        .log-box {
            background: #1e293b;
            color: #10b981;
            font-family: 'SF Mono', 'Courier New', monospace;
            font-size: 0.85rem;
            padding: 15px;
            border-radius: 12px;
            margin-top: 20px;
            height: 200px;
            overflow-y: auto;
            border: 1px solid #334155;
            display: none;
            line-height: 1.5;
        }
        .log-line { margin-bottom: 4px; border-bottom: 1px solid #334155; padding-bottom: 2px; }
        .log-error { color: #ef4444; }
        .log-info { color: #3b82f6; }
        .log-warn { color: #f59e0b; }

        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); backdrop-filter: blur(2px); z-index: 1000; justify-content: center; align-items: center; }
        .modal-content { background: white; padding: 24px; border-radius: 16px; width: 90%; max-width: 450px; box-shadow: 0 20px 25px rgba(0,0,0,0.1); }
        .admin-indicator { position: fixed; top: 20px; right: 20px; z-index: 900; }
        .admin-badge { background: #10b981; color: white; padding: 8px 16px; border-radius: 20px; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .admin-badge.logged-out { background: #ef4444; }
        
        .progress-bar { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin: 10px 0; display: none; }
        .progress-fill { height: 100%; background: #3b82f6; width: 0%; transition: width 0.3s; }

        @media (max-width: 768px) {
            .header { flex-direction: column; text-align: center; gap: 15px; }
            .button { width: 100%; justify-content: center; }
            .ip-item { flex-direction: column; align-items: flex-start; gap: 8px; }
            .ip-info { width: 100%; justify-content: space-between; }
            .action-buttons { width: 100%; justify-content: flex-end; }
        }
    </style>
</head>
<body>
    <div class="admin-indicator">
        <div class="admin-badge ${isLoggedIn ? '' : 'logged-out'}" onclick="${isLoggedIn ? 'logout()' : 'openLoginModal()'}" id="admin-badge">
            ${isLoggedIn ? '🔐 管理員' : '🔓 點擊登入'}
        </div>
    </div>

    <div class="container">
        <div class="header">
            <div class="header-content">
                <h1>Cloudflare 優選 IP 收集器</h1>
                <p>V3.1.1</p>
            </div>
            <div>
                <a href="https://github.com/ethgan/CF-Worker-BestIP-collector" target="_blank" class="social-link">GitHub</a>
                <a href="https://t.me/yt_hytj" target="_blank" class="social-link">TG</a>
            </div>
        </div>

        <div class="card">
            <h2>📊 系統狀態</h2>
            <div class="stats">
                <div class="stat"><div class="stat-value" id="ip-count">${data.count || 0}</div><div>IP 總數</div></div>
                <div class="stat"><div class="stat-value" id="last-time">${data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : '從未'}</div><div>更新時間</div></div>
                <div class="stat"><div class="stat-value" id="fast-ip-count">${fastIPs.length}</div><div>優質 IP</div></div>
            </div>
            
            <div class="button-group">
                <button class="button" onclick="updateIPs()" id="update-btn">🔄 立即更新庫</button>
                <button class="button button-warning" onclick="startSpeedTest()" id="speedtest-btn">⚡ 瀏覽器測速</button>
                
                <div class="dropdown">
                    <a href="${addAuthToUrl('/fast-ips.txt', sessionId, tokenConfig)}" class="button button-success dropdown-btn" download="cloudflare_fast_ips.txt">
                        🚀 下載優質 IP ▼
                    </a>
                    <div class="dropdown-content">
                        <a href="${addAuthToUrl('/ips', sessionId, tokenConfig)}" download="all_ips.txt">📥 下載完整庫</a>
                        <a href="${addAuthToUrl('/browser-ips.txt', sessionId, tokenConfig)}" download="my_speedtest_result.txt">💾 下載本機測速結果</a>
                    </div>
                </div>

                <div class="dropdown">
                    <a href="${addAuthToUrl('/fast-ips.txt', sessionId, tokenConfig)}" class="button button-secondary dropdown-btn" target="_blank">
                        🔗 查看優質 IP ▼
                    </a>
                    <div class="dropdown-content">
                        <a href="${addAuthToUrl('/ip.txt', sessionId, tokenConfig)}" target="_blank">📋 查看完整庫</a>
                        <a href="${addAuthToUrl('/browser-ips.txt', sessionId, tokenConfig)}" target="_blank">📄 查看本機測速結果</a>
                    </div>
                </div>

                <button class="button" onclick="openItdogModal()" style="background: #8b5cf6;">🌐 ITDog 測速</button>
                <button class="button ${isLoggedIn ? 'button-secondary' : ''}" onclick="openTokenModal()" id="token-btn" ${!isLoggedIn ? 'disabled' : ''}>🔑 Token 管理</button>
            </div>
            
            <div id="log-box" class="log-box"></div>
            
             ${isLoggedIn && tokenConfig ? `
            <div style="margin-top: 15px; padding: 10px; background: #f1f5f9; border-radius: 8px; font-size: 0.85rem;">
                <strong>當前 Token:</strong> <span style="font-family:monospace; background:white; padding:2px 6px; border-radius:4px;">${tokenConfig.token}</span>
                <span style="color:#64748b; margin-left:10px;">(過期: ${tokenConfig.neverExpire ? '永不' : new Date(tokenConfig.expires).toLocaleDateString()})</span>
            </div>` : ''}
        </div>

        <div class="card">
            <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                <h2 id="list-title">🏆 優質 IP 列表</h2>
                <button class="small-btn" onclick="copyAllFastIPs()">📋 複製所有 IP</button>
            </div>
            
            <div class="progress-bar" id="progress"><div class="progress-fill" id="progress-fill"></div></div>
            <div id="status-text" style="text-align:center; font-size:0.85rem; color:#64748b; margin-bottom:10px;"></div>

            <div class="ip-list" id="ip-list">
                ${fastIPs.length > 0 ? fastIPs.map(item => {
                    const speedClass = item.latency < 200 ? 'speed-fast' : item.latency < 500 ? 'speed-medium' : 'speed-slow';
                    const colo = item.colo || '---';
                    const isGoodForGD = ['HKG', 'SJC', 'LAX', 'TPE'].includes(colo);
                    const coloStyle = isGoodForGD ? 'background:#dcfce7; color:#166534;' : '';
                    
                    return `<div class="ip-item" data-ip="${item.ip}">
                        <div class="ip-info">
                            <span class="colo-badge" style="${coloStyle}">${colo}</span>
                            <span class="ip-address">${item.ip}</span>
                            <span class="speed-result ${speedClass}" id="speed-${item.ip.replace(/\./g, '-')}">${item.latency}ms</span>
                        </div>
                        <div class="action-buttons">
                            <button class="small-btn" onclick="copyIP('${item.ip}')">複製</button>
                        </div>
                    </div>`;
                }).join('') : '<p style="text-align:center; padding:30px; color:#94a3b8;">暫無數據，請點擊更新</p>'}
            </div>
        </div>
    </div>

    <!-- 模態框組件 -->
    <div class="modal" id="itdog-modal">
        <div class="modal-content">
            <h3>🌐 ITDog 測速</h3>
            <p style="margin-bottom:15px; color:#475569; font-size:0.95rem;">此功能將複製「優質 IP 列表」中的 IP 地址 (約 ${FAST_IP_COUNT} 個)。請前往 ITDog 的批量 Ping/TCPing 頁面進行測試，以獲得最準確的連線速度。</p>
            <div style="text-align:right;">
                <button class="button button-secondary" onclick="document.getElementById('itdog-modal').style.display='none'">關閉</button>
                <button class="button" onclick="copyIPsForItdog()">📋 複製優質 IP 並前往</button>
            </div>
        </div>
    </div>
    
    <div class="modal" id="login-modal">
        <div class="modal-content">
            <h3>🔐 管理員登入</h3>
            <div class="admin-hint ${hasAdminPassword ? '' : 'warning'}" style="margin-bottom:10px; font-size:0.9rem; color:${hasAdminPassword?'#64748b':'#ef4444'};">
                ${hasAdminPassword ? '請輸入密碼' : '⚠️ 未設置 ADMIN_PASSWORD 環境變數'}
            </div>
            <input type="password" id="admin-pass" placeholder="輸入密碼" style="width:100%; padding:10px; margin:15px 0; border:1px solid #cbd5e1; border-radius:8px;" ${!hasAdminPassword?'disabled':''}>
            <div style="text-align:right;">
                <button class="button button-secondary" onclick="document.getElementById('login-modal').style.display='none'">取消</button>
                <button class="button" onclick="login()" ${!hasAdminPassword?'disabled':''} id="login-confirm-btn">登入</button>
            </div>
        </div>
    </div>

    <div class="modal" id="token-modal">
        <div class="modal-content">
            <h3>⚙️ Token 設定</h3>
            <input type="text" id="token-in" placeholder="Token" style="width:100%; padding:10px; margin:10px 0; border:1px solid #cbd5e1; border-radius:8px;">
            <div style="margin-bottom:15px;">
                <label><input type="checkbox" id="never-expire"> 永不過期</label>
                <input type="number" id="expire-days" placeholder="過期天數 (30)" style="width:80px; margin-left:10px; padding:5px;">
            </div>
            <div style="text-align:right;">
                <button class="button button-secondary" onclick="document.getElementById('token-modal').style.display='none'">取消</button>
                <button class="button" onclick="saveToken()">儲存</button>
            </div>
        </div>
    </div>

    <script>
        let sessionId = '${sessionId || ''}';
        let isLoggedIn = ${isLoggedIn};
        let tokenConfig = ${tokenConfig ? JSON.stringify(tokenConfig) : 'null'};
        const MAX_TEST = ${AUTO_TEST_MAX_IPS};
        const DISPLAY_COUNT = ${FAST_IP_COUNT};

        document.addEventListener('DOMContentLoaded', function() {
            const passInput = document.getElementById('admin-pass');
            if(passInput) {
                passInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault(); 
                        login();
                    }
                });
            }
        });

        function addLog(msg, type='normal') {
            const box = document.getElementById('log-box');
            box.style.display = 'block';
            const time = new Date().toLocaleTimeString();
            let className = 'log-line';
            if(type==='error') className += ' log-error';
            if(type==='info') className += ' log-info';
            if(type==='warn') className += ' log-warn';
            
            box.innerHTML += \`<div class="\${className}">[\${time}] \${msg}</div>\`;
            box.scrollTop = box.scrollHeight;
        }
        function clearLog() {
            document.getElementById('log-box').innerHTML = '';
        }

        async function api(path, method='GET', body=null) {
            const headers = { 'Content-Type': 'application/json' };
            if (sessionId) headers['Authorization'] = 'Bearer ' + sessionId;
            else if (tokenConfig) headers['Authorization'] = 'Token ' + tokenConfig.token;
            
            const opts = { method, headers };
            if (body) opts.body = JSON.stringify(body);
            
            let url = path;
            if (method === 'GET' && (sessionId || tokenConfig)) {
                const char = url.includes('?') ? '&' : '?';
                if(tokenConfig) url += char + 'token=' + encodeURIComponent(tokenConfig.token);
                else if(sessionId) url += char + 'session=' + encodeURIComponent(sessionId);
            }

            const res = await fetch(url, opts);
            return res.json();
        }

        async function updateIPs() {
            const btn = document.getElementById('update-btn');
            btn.disabled = true;
            btn.innerText = '更新中...';
            clearLog();
            addLog('🚀 開始執行後端更新...', 'info');
            addLog('⏳ 等待 Cloudflare Worker 回應...');
            
            try {
                const res = await api('/update', 'POST');
                if(res.success) { 
                    addLog(\`✅ 更新成功！\`, 'info');
                    addLog(\`📊 收集 IP 總數: \${res.totalIPs}\`);
                    setTimeout(() => location.reload(), 2000); 
                }
                else addLog('❌ 失敗: ' + res.error, 'error');
            } catch(e) { 
                addLog('❌ 請求發生錯誤: ' + e.message, 'error'); 
            }
            btn.disabled = false;
            btn.innerText = '🔄 立即更新庫';
        }

        async function startSpeedTest() {
            const allIpElements = document.querySelectorAll('.ip-item');
            let allIps = [];
            try {
                const res = await api('/raw');
                if(res.ips && res.ips.length > 0) allIps = res.ips;
                else throw new Error('No IPs');
            } catch(e) {
                allIps = Array.from(allIpElements).map(el => el.dataset.ip);
            }

            if(allIps.length === 0) return addLog('❌ 無 IP 可測', 'error');
            
            clearLog();
            addLog(\`🚀 開始瀏覽器測速\`, 'info');
            addLog(\`📄 IP 庫總數: \${allIps.length}\`);
            
            addLog('🎲 正在隨機打亂 IP 列表...');
            for (let i = allIps.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allIps[i], allIps[j]] = [allIps[j], allIps[i]];
            }
            
            const targets = allIps.slice(0, MAX_TEST);
            addLog(\`🎯 隨機抽取 \${targets.length} 個 IP 進行測試...\`, 'info');

            document.getElementById('progress').style.display = 'block';
            document.getElementById('speedtest-btn').disabled = true;
            
            let count = 0;
            let successCount = 0;
            let results = [];
            
            for(const ip of targets) {
                document.getElementById('status-text').innerText = \`正在測試 \${ip} (\${count+1}/\${targets.length})...\`;
                
                try {
                    const start = performance.now();
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    
                    const res = await fetch(\`/speedtest?ip=\${ip}\`, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    const data = await res.json();
                    const latency = Math.round(performance.now() - start);
                    
                    if(data.success) {
                        const colo = data.colo || 'UNK';
                        const speedType = latency < 200 ? '極快' : latency < 500 ? '普通' : '慢速';
                        let logType = 'normal';
                        if(latency < 200) logType = 'info';
                        
                        addLog(\`✅ [\${colo}] \${ip} - \${latency}ms (\${speedType})\`, logType);
                        results.push({ip, latency, colo});
                        successCount++;
                    } else {
                        addLog(\`❌ \${ip} - 連接失敗\`, 'warn');
                    }
                } catch(e) { 
                    addLog(\`❌ \${ip} - 超時\`, 'warn');
                }
                
                count++;
                document.getElementById('progress-fill').style.width = (count/targets.length*100) + '%';
                await new Promise(r => setTimeout(r, 100));
            }
            
            addLog('🏁 測速完成！', 'info');
            addLog(\`📊 有效 IP: \${successCount} / \${targets.length}\`);
            
            if(results.length > 0) {
                addLog('🏆 正在更新列表為本地實測最快 IP...', 'info');
                results.sort((a,b) => a.latency - b.latency);
                const topResults = results.slice(0, DISPLAY_COUNT);
                
                const listEl = document.getElementById('ip-list');
                let newHtml = '';
                topResults.forEach(item => {
                    const speedClass = item.latency < 200 ? 'speed-fast' : item.latency < 500 ? 'speed-medium' : 'speed-slow';
                    const isGoodForGD = ['HKG', 'SJC', 'LAX', 'TPE'].includes(item.colo);
                    const coloStyle = isGoodForGD ? 'background:#dcfce7; color:#166534;' : '';
                    newHtml += \`<div class="ip-item" data-ip="\${item.ip}"><div class="ip-info"><span class="colo-badge" style="\${coloStyle}">\${item.colo}</span><span class="ip-address">\${item.ip}</span><span class="speed-result \${speedClass}">\${item.latency}ms</span></div><div class="action-buttons"><button class="small-btn" onclick="copyIP('\${item.ip}')">複製</button></div></div>\`;
                });
                listEl.innerHTML = newHtml;
                document.getElementById('list-title').innerHTML = '🏆 優質 IP 列表 (本地實測)';
                
                addLog('☁️ 正在上傳測速結果到伺服器...', 'info');
                try {
                    await api('/upload-results', 'POST', { fastIPs: topResults });
                    addLog('✅ 結果已同步至雲端，下次訪問將顯示此結果。', 'info');
                } catch(e) {
                    addLog('❌ 上傳失敗: ' + e.message, 'error');
                }
            } else {
                addLog('⚠️ 沒有測到有效的 IP。', 'warn');
            }

            document.getElementById('status-text').innerText = '測速完成';
            document.getElementById('speedtest-btn').disabled = false;
            setTimeout(() => document.getElementById('progress').style.display = 'none', 3000);
        }

        function openLoginModal() { 
            document.getElementById('login-modal').style.display='flex'; 
            setTimeout(() => document.getElementById('admin-pass').focus(), 100);
        }
        
        async function login() {
            const pwd = document.getElementById('admin-pass').value;
            const btn = document.getElementById('login-confirm-btn');
            btn.disabled = true;
            btn.innerText = '登入中...';
            
            const res = await api('/admin-login', 'POST', {password: pwd});
            if(res.success) {
                const url = new URL(window.location.href);
                url.searchParams.set('session', res.sessionId);
                window.location.href = url.toString();
            } else {
                alert(res.error);
                btn.disabled = false;
                btn.innerText = '登入';
            }
        }
        
        async function logout() {
            await api('/admin-logout', 'POST');
            const url = new URL(window.location.href);
            url.searchParams.delete('session');
            window.location.href = url.toString();
        }

        function openTokenModal() { document.getElementById('token-modal').style.display='flex'; }
        async function saveToken() {
            const token = document.getElementById('token-in').value;
            const never = document.getElementById('never-expire').checked;
            const days = document.getElementById('expire-days').value;
            const res = await api('/admin-token', 'POST', {token, neverExpire: never, expiresDays: parseInt(days)});
            if(res.success) location.reload(); else alert(res.error);
        }

        function copyIP(ip) { navigator.clipboard.writeText(ip); alert('已複製 ' + ip); }
        function copyAllFastIPs() {
            const ips = Array.from(document.querySelectorAll('.ip-address')).map(el => el.innerText).join('\\n');
            navigator.clipboard.writeText(ips); alert('已複製所有 IP');
        }
        function openItdogModal() { document.getElementById('itdog-modal').style.display='flex'; }
        
        async function copyIPsForItdog() {
            const ips = Array.from(document.querySelectorAll('.ip-address')).map(el => el.innerText).join('\\n');
            if(ips) {
                navigator.clipboard.writeText(ips);
                window.open('https://www.itdog.cn/batch_tcping/', '_blank');
            } else alert('無 IP 可複製');
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
    return jsonResponse({ 
        success: true, 
        duration: (Date.now()-start)+'ms', 
        totalIPs: uniqueIPs.length
    });
  }

  async function handleUploadResults(env, request) {
      if (!await verifyAdmin(request, env)) return jsonResponse({ error: '需要權限' }, 401);
      try {
          const { fastIPs } = await request.json();
          if (!fastIPs || !Array.isArray(fastIPs)) return jsonResponse({ error: '無效數據' }, 400);
          await env.IP_STORAGE.put('browser_fast_ips', JSON.stringify({
              fastIPs: fastIPs,
              lastTested: new Date().toISOString(),
              count: fastIPs.length,
              source: 'browser_upload'
          }));
          return jsonResponse({ success: true });
      } catch (e) {
          return jsonResponse({ error: e.message }, 500);
      }
  }

  async function handleGetBrowserIPsText(env, request) {
    if (!await verifyAdmin(request, env)) return jsonResponse({ error: '無權限' }, 401);
    const data = await getStoredBrowserIPs(env);
    const txt = (data.fastIPs||[]).map(i => `${i.ip}#${i.colo||'UNK'}:${i.latency}ms`).join('\n');
    return new Response(txt, { headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'inline; filename="browser_speedtest.txt"' } });
  }

  async function autoSpeedTestAndStore(env, ips) {
    if (!ips || !ips.length) return null;
    let randomIPs = [...ips];
    for (let i = randomIPs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [randomIPs[i], randomIPs[j]] = [randomIPs[j], randomIPs[i]];
    }
    const targets = randomIPs.slice(0, AUTO_TEST_MAX_IPS);
    const results = [];
    const BATCH = 5;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const promises = batch.map(ip => testIPSpeed(ip));
      const outcomes = await Promise.allSettled(promises);
      for (const out of outcomes) {
        if (out.status === 'fulfilled' && out.value.success) {
            results.push({ ip: out.value.ip, latency: Math.round(out.value.latency), colo: out.value.colo });
        }
      }
      if (i + BATCH < targets.length) await new Promise(r => setTimeout(r, 200));
    }
    results.sort((a, b) => a.latency - b.latency);
    const fastIPs = results.slice(0, FAST_IP_COUNT);
    await env.IP_STORAGE.put('cloudflare_fast_ips', JSON.stringify({
      fastIPs, lastTested: new Date().toISOString(), count: fastIPs.length, source: 'backend_auto'
    }));
  }

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
      const colo = ray ? ray.split('-').pop() : null;
      return jsonResponse({ success: true, ip, colo, time: new Date() });
    } catch (error) { return jsonResponse({ success: false, ip, error: error.message }, 200); }
  }

  async function testIPSpeed(ip) {
    try {
      const start = Date.now();
      const res = await fetch(`https://speed.cloudflare.com/__down?bytes=1000`, { headers: { 'Host': 'speed.cloudflare.com' }, cf: { resolveOverride: ip }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await res.text();
      const latency = Date.now() - start;
      const ray = res.headers.get('cf-ray');
      const colo = ray ? ray.split('-').pop() : null;
      return { success: true, ip, latency, colo };
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

  async function handleGetFastIPsText(env, request) { if (!await verifyAdmin(request, env)) return jsonResponse({ error: '無權限' }, 401); const d = await getStoredSpeedIPs(env); return new Response((d.fastIPs||[]).map(i => `${i.ip}#${i.colo||'UNK'}:${i.latency}ms`).join('\n'), { headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'inline; filename="fast_ips.txt"' } }); }
  async function handleGetFastIPs(env, request) { if (!await verifyAdmin(request, env)) return jsonResponse({ error: '無權限' }, 401); return jsonResponse(await getStoredSpeedIPs(env)); }
  async function handleGetIPs(env, request) { if (!await verifyAdmin(request, env)) return jsonResponse({ error: '無權限' }, 401); const d = await getStoredIPs(env); return new Response(d.ips.join('\n'), { headers: {'Content-Type': 'text/plain'} }); }
  async function handleRawIPs(env, request) { if (!await verifyAdmin(request, env)) return jsonResponse({ error: '無權限' }, 401); return jsonResponse(await getStoredIPs(env)); }
  async function handleItdogData(env, request) { if (!await verifyAdmin(request, env)) return jsonResponse({ error: '無權限' }, 401); const d = await getStoredSpeedIPs(env); return jsonResponse({ ips: (d.fastIPs||[]).map(i => i.ip) }); }

  async function getStoredIPs(env) { try { return JSON.parse(await env.IP_STORAGE.get('cloudflare_ips')) || {ips:[]}; } catch { return {ips:[]}; } }
  async function getStoredSpeedIPs(env) { try { return JSON.parse(await env.IP_STORAGE.get('cloudflare_fast_ips')) || {fastIPs:[]}; } catch { return {fastIPs:[]}; } }
  async function getStoredBrowserIPs(env) { try { return JSON.parse(await env.IP_STORAGE.get('browser_fast_ips')) || {fastIPs:[]}; } catch { return {fastIPs:[]}; } }
  
  function expandCIDR(cidr) { try { const [ip, m] = cidr.split('/'); const mask = parseInt(m); if(isNaN(mask)||mask>32) return [ip]; if(mask===32) return [ip]; const start = ipToNum(ip); const len = Math.pow(2, 32-mask); const res = []; for(let i=0; i<(len>256?256:len); i++) res.push(numToIp(start+i)); return res; } catch { return []; } }
  function ipToNum(ip) { return ip.split('.').reduce((a,b) => (a<<8)+parseInt(b),0)>>>0; }
  function numToIp(n) { return [(n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255].join('.'); }
  function isValidIPv4(ip) { return /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip); }
  async function fetchURLWithTimeout(url) { const c = new AbortController(); setTimeout(() => c.abort(), 8000); const res = await fetch(url, { signal: c.signal, headers: {'User-Agent': 'CF-Worker'} }); if(!res.ok) throw new Error(res.status); return await res.text(); }
  function jsonResponse(data, status=200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
  function handleCORS() { return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } }); }
