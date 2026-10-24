// ===== 功能：聊天关键词彩蛋动画（聊天页更多功能 → 彩蛋） =====
// 聊天里出现触发词（发出或收到都算）时，屏幕飘对应表情动画（爱心/太阳/星星等）。
// 自包含模块：动画层/样式/管理面板 DOM 均由本文件生成，不依赖 template 结构。
// 开关与自定义规则存 localStorage（xy-home-v2:chat-fx-*），默认开启、含预设规则。
// 监听方式：MutationObserver 观察 #chat-msgs 追加——分页重渲染（一次大量追加）不触发，
// 每个触发词 5 秒冷却防连刷。
(function () {
  var ROOT = 'xy-home-v2:chat-fx';
  var ON_KEY = ROOT + ':on';
  var CUSTOM_KEY = ROOT + ':custom';

  // ---- 预设规则：关键词（正则源） → 表情组 ----
  var PRESETS = [
    { kw: '我爱你|爱你|love', emojis: ['❤️', '💗', '💖'], name: '爱心' },
    { kw: '早安|早上好|早呀', emojis: ['☀️', '🌻'], name: '早安' },
    { kw: '晚安|睡觉|困了', emojis: ['🌙', '⭐', '💤'], name: '晚安' },
    { kw: '想你|想你啦', emojis: ['💭', '💗'], name: '想你' },
    { kw: '生日快乐', emojis: ['🎂', '🎉', '🎈'], name: '生日' },
    { kw: '么么|亲亲|mua', emojis: ['💋', '😘'], name: '亲亲' },
    { kw: '恭喜|好厉害|太棒了', emojis: ['🎉', '✨'], name: '庆祝' },
    { kw: '哈哈哈哈|哈哈|笑死', emojis: ['😂', '🤣'], name: '大笑' }
  ];

  function loadOn() { try { return localStorage.getItem(ON_KEY) !== '0'; } catch (e) { return true; } }
  function saveOn(v) { try { localStorage.setItem(ON_KEY, v ? '1' : '0'); } catch (e) {} }
  function loadCustom() { try { var a = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveCustom(a) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(a)); } catch (e) {} }

  // ---- 动画层 + 样式（注入一次） ----
  var layer = null;
  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    var st = document.getElementById('chat-fx-style');
    if (!st) {
      st = document.createElement('style'); st.id = 'chat-fx-style';
      st.textContent =
        '.chat-fx-layer{position:absolute;top:0;left:0;right:0;bottom:0;z-index:500;pointer-events:none;overflow:hidden}' +
        '.chat-fx-em{position:absolute;bottom:-60px;will-change:transform,opacity;animation:chatFxUp linear forwards}' +
        '@keyframes chatFxUp{0%{transform:translateY(0) translateX(0) rotate(0);opacity:0}' +
        '8%{opacity:1}80%{opacity:1}100%{transform:translateY(-105vh) translateX(var(--fx-sway,20px)) rotate(var(--fx-rot,20deg));opacity:0}}' +
        '.chat-fx-panel{position:absolute;top:0;left:0;right:0;bottom:0;z-index:1200;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.35)}' +
        '.chat-fx-panel[hidden]{display:none}' +
        '.chat-fx-card{width:min(480px,92vw);max-height:70vh;overflow-y:auto;background:var(--card-bg,#fff);border-radius:16px 16px 0 0;padding:16px 14px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box;font-size:14px}' +
        '.chat-fx-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:700}' +
        '.chat-fx-x{border:0;background:none;font-size:18px;cursor:pointer;padding:4px 8px}' +
        '.chat-fx-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,.15)}' +
        '.chat-fx-row:last-of-type{border-bottom:0}' +
        '.chat-fx-kw{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.chat-fx-ems{font-size:18px;white-space:nowrap}' +
        '.chat-fx-del{border:0;background:rgba(220,38,38,.12);color:#dc2626;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px}' +
        '.chat-fx-add{display:flex;gap:6px;margin-top:10px}' +
        '.chat-fx-add input{flex:1;min-width:0;padding:8px 10px;border:1px solid rgba(128,128,128,.35);border-radius:10px;background:var(--card-bg,#fff);color:inherit;font-size:14px}' +
        '.chat-fx-btn{border:0;background:#111;color:#fff;border-radius:10px;padding:8px 14px;cursor:pointer;font-size:14px}' +
        '.chat-fx-hint{color:#999;font-size:12px;margin-top:8px;line-height:1.6}';
      document.head.appendChild(st);
    }
    layer = document.getElementById('chat-fx-layer');
    if (!layer) { layer = document.createElement('div'); layer.id = 'chat-fx-layer'; layer.className = 'chat-fx-layer'; (document.getElementById('page-chat') || document.body).appendChild(layer); }
    return layer;
  }

  // ---- 触发动画 ----
  var cooldown = {}; // 关键词 -> 上次触发时间戳
  function fireFx(emojis, key) {
    if (!loadOn()) return;
    var now = Date.now();
    if (key && cooldown[key] && now - cooldown[key] < 5000) return;
    cooldown[key] = now;
    var lay = ensureLayer();
    if (!lay) return;
    var n = 10 + Math.floor(Math.random() * 6); // 10~15 个
    for (var i = 0; i < n; i++) {
      (function () {
        var el = document.createElement('div');
        el.className = 'chat-fx-em';
        el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        el.style.left = (4 + Math.random() * 90) + '%';
        el.style.fontSize = (18 + Math.random() * 20) + 'px';
        el.style.setProperty('--fx-sway', ((Math.random() - 0.5) * 120).toFixed(0) + 'px');
        el.style.setProperty('--fx-rot', ((Math.random() - 0.5) * 60).toFixed(0) + 'deg');
        var dur = 2.4 + Math.random() * 1.6;
        el.style.animationDuration = dur.toFixed(2) + 's';
        el.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
        el.addEventListener('animationend', function () { el.remove(); });
        lay.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.remove(); }, (dur + 1.5) * 1000); // 兜底清理
      })();
    }
  }

  // ---- 关键词匹配 ----
  function matchAll(text) {
    if (!text || !loadOn()) return null;
    var t = String(text);
    var hits = [];
    for (var i = 0; i < PRESETS.length; i++) {
      try { if (new RegExp(PRESETS[i].kw).test(t)) hits.push(PRESETS[i]); } catch (e) {}
    }
    var custom = loadCustom();
    for (var j = 0; j < custom.length; j++) {
      var c = custom[j];
      if (!c || !c.kw || !c.emojis || !c.emojis.length) continue;
      var src = c.kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 自定义词按字面匹配
      try { if (new RegExp(src).test(t)) hits.push({ kw: c.kw, emojis: c.emojis }); } catch (e) {}
    }
    return hits.length ? hits : null;
  }

  function fireForText(text) {
    var hits = matchAll(text);
    if (!hits) return;
    for (var i = 0; i < hits.length; i++) fireFx(hits[i].emojis, hits[i].kw);
  }

  // ---- 监听新消息：观察 #chat-msgs 追加 ----
  function watchChat() {
    var box = document.getElementById('chat-msgs');
    if (!box) { setTimeout(watchChat, 1200); return; } // 聊天页可能后建
    if (box.__cfxWatched) return;
    box.__cfxWatched = true;
    new MutationObserver(function (muts) {
      if (!loadOn()) return;
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        if (!added || !added.length) continue;
        // 分页/重渲染：一次追加很多节点 → 跳过（只有真实新消息是少量追加）
        if (added.length > 5) continue;
        var last = added[added.length - 1];
        if (!last || last.nodeType !== 1) continue;
        var txt = (last.textContent || '').trim();
        if (txt) fireForText(txt.slice(0, 400));
      }
    }).observe(box, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchChat);
  else watchChat();
  setTimeout(watchChat, 2500); // 聊天容器晚建兜底

  // ---- 管理面板 ----
  var panel = null;
  function buildPanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'chat-fx-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="chat-fx-card">' +
      '<div class="chat-fx-head"><span>✨ 关键词彩蛋</span><button class="chat-fx-x" data-fx="close">✕</button></div>' +
      '<label class="chat-fx-row" style="cursor:pointer"><input type="checkbox" id="chat-fx-on"> <span>开启彩蛋动画</span></label>' +
      '<div id="chat-fx-rules"></div>' +
      '<div class="chat-fx-add"><input id="chat-fx-new-kw" placeholder="触发词，如：抱抱" maxlength="30"><input id="chat-fx-new-em" placeholder="表情，如：🤗💞" maxlength="12"><button class="chat-fx-btn" data-fx="add">添加</button></div>' +
      '<div class="chat-fx-hint">聊天里发出或收到包含触发词的消息时，屏幕会飘对应表情。<br>预设规则（爱心·早安·晚安·想你·生日·亲亲·庆祝·大笑）无需添加即生效，不可删除；下方是自定义规则，点删除可移除。</div>' +
      '</div>';
    (document.getElementById('page-chat') || document.body).appendChild(panel);
    // 点击遮罩关闭
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.hidden = true; });
    var x = panel.querySelector('[data-fx="close"]');
    if (x) x.addEventListener('click', function () { panel.hidden = true; });
    var on = panel.querySelector('#chat-fx-on');
    on.checked = loadOn();
    on.addEventListener('change', function () { saveOn(on.checked); if (on.checked) fireFx(['✨', '🎉'], '__test'); });
    var addBtn = panel.querySelector('[data-fx="add"]');
    if (addBtn) addBtn.addEventListener('click', addCustom);
    renderRules();
    return panel;
  }
  function renderRules() {
    if (!panel) return;
    var box = panel.querySelector('#chat-fx-rules');
    if (!box) return;
    var custom = loadCustom();
    var html = '';
    if (custom.length) {
      html += '<div class="chat-fx-hint" style="margin:6px 0 2px">自定义规则：</div>';
      for (var i = 0; i < custom.length; i++) {
        var c = custom[i];
        html += '<div class="chat-fx-row"><span class="chat-fx-kw">' + escH(c.kw) + '</span>' +
          '<span class="chat-fx-ems">' + escH((c.emojis || []).join(' ')) + '</span>' +
          '<button class="chat-fx-del" data-fx-del="' + i + '">删除</button></div>';
      }
    } else {
      html += '<div class="chat-fx-hint" style="margin:6px 0 2px">还没有自定义规则，在下方添加～</div>';
    }
    box.innerHTML = html;
    var dels = box.querySelectorAll('[data-fx-del]');
    for (var j = 0; j < dels.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var arr = loadCustom();
          arr.splice(parseInt(btn.getAttribute('data-fx-del'), 10), 1);
          saveCustom(arr);
          renderRules();
        });
      })(dels[j]);
    }
  }
  function addCustom() {
    if (!panel) return;
    var kwI = panel.querySelector('#chat-fx-new-kw');
    var emI = panel.querySelector('#chat-fx-new-em');
    var kw = (kwI.value || '').trim();
    var emsRaw = (emI.value || '').trim();
    if (!kw || !emsRaw) return;
    var ems = Array.from(emsRaw.replace(/\s+/g, '')).slice(0, 4); // 拆字符（含 emoji 代理对）
    if (!ems.length) return;
    var arr = loadCustom();
    for (var i = 0; i < arr.length; i++) { if (arr[i].kw === kw) { arr.splice(i, 1); break; } } // 同词覆盖
    arr.push({ kw: kw, emojis: ems });
    saveCustom(arr);
    kwI.value = ''; emI.value = '';
    renderRules();
    fireFx(ems, '__preview');
  }
  function escH(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- 对外入口 ----
  window.openChatFxPanel = function () { buildPanel(); panel.hidden = false; };
  window.closeChatFxPanel = function () { if (panel) panel.hidden = true; };
  window.fireChatFx = fireForText; // 供其他模块直接触发
})();
