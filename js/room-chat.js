// ===== 房间 · 和 TA 聊天（AI 一次三条、TA 挑一条）独立模块 =====
// 设计红线：完全独立，不改聊天页（page-chat / chat.js / 聊天数据）。
// 只做两件事：
//   1) 在房间页底部按钮条 .r-bar 末尾注入一个「聊天」按钮（JS 注入，模板不动）
//   2) 在 .phone 手机壳内叠一层自有浮层（样式由本文件注入 <style>，不动任何 css 文件）
//
// 玩法：你说一句话 → 调 OpenAI 兼容接口一次生成 3 条候选 → 由代码随机挑一条
//（候选面板里会高亮被选中的那条、其余置灰标「没选」）→ 作为 TA 的回复落进对话。
// 这样「TA 选择了哪一种」是看得见的。
//
// 数据：
//   配置  localStorage 'mochi:roomchat:cfg'（base / key / model / world，全局一份）
//   对话  localStorage 'mochi:roomchat:thread:<联系人>'（按当前联系人隔离）
// 未配置 API 时：界面照常可用，只提示去设置里填三项；绝不报错、不阻塞。
(function () {
  'use strict';
  if (window.__roomChatBooted) return;
  window.__roomChatBooted = 1;

  var CFG_KEY = 'mochi:roomchat:cfg';
  var THREAD_PREFIX = 'mochi:roomchat:thread:';
  var MAX_KEEP = 120;

  // ---------- 小工具 ----------
  function myCid() { try { return window.__activeCid || 'default'; } catch (e) { return 'default'; } }
  function activeS() { try { return window.activeStore(); } catch (e) { return null; } }
  function partnerName() {
    try {
      var s = activeS();
      var n = s && (s.get('lbl-partner') || s.get('cs-lbl-partner'));
      if (n) return String(n);
    } catch (e) {}
    try { if (window.contactNameFor) { var x = window.contactNameFor(myCid()); if (x) return String(x); } } catch (e) {}
    return 'TA';
  }
  function partnerAvatar() {
    try { var s = activeS(); return String((s && (s.get('cs-avatar-partner') || s.get('avatar-partner'))) || ''); } catch (e) { return ''; }
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function readJSON(k, d) { try { var t = lsGet(k); return t ? JSON.parse(t) : d; } catch (e) { return d; } }
  function writeJSON(k, v) { try { lsSet(k, JSON.stringify(v)); } catch (e) {} }
  function toast(t) {
    try {
      var el = document.getElementById('cc-toast');
      if (!el) { el = document.createElement('div'); el.id = 'cc-toast'; document.body.appendChild(el); }
      el.textContent = t; el.className = 'cc-toast'; void el.offsetWidth; el.className = 'cc-toast show';
      clearTimeout(toast._t); toast._t = setTimeout(function () { el.className = 'cc-toast'; }, 2000);
    } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- 配置 ----------
  function cfg() {
    var c = readJSON(CFG_KEY, {});
    return { base: c.base || '', key: c.key || '', model: c.model || '', world: c.world || '' };
  }
  function cfgReady() { var c = cfg(); return !!(c.base && c.key && c.model); }
  function saveCfg(c) { writeJSON(CFG_KEY, { base: c.base, key: c.key, model: c.model, world: c.world }); }

  // ---------- 对话 ----------
  function loadThread() {
    var a = readJSON(THREAD_PREFIX + myCid(), []);
    return Array.isArray(a) ? a : [];
  }
  function saveThread(list) {
    try { writeJSON(THREAD_PREFIX + myCid(), list.slice(-MAX_KEEP)); } catch (e) {}
  }

  // ---------- 调 AI：一次要三条 ----------
  function buildPrompt() {
    var name = partnerName();
    var c = cfg();
    var sys = '你正在扮演「' + name + '」，和对方在一个只属于你们两人的小屋里聊天。' +
      (c.world ? '人设与背景：' + c.world + '。' : '') +
      '请一次性给出 3 条候选回复，三条风格要有区别（比如：温柔、调皮、别扭/傲娇，各一条）。' +
      '严格要求：只输出一段 JSON，格式为 {"replies":["第一条","第二条","第三条"]}，不要输出任何其他文字、不要加代码块。' +
      '每条 60 字以内，中文口语，不写动作描写括号，不加序号，不用引号。';
    var lines = [];
    loadThread().slice(-6).forEach(function (m) {
      if (!m || !m.text) return;
      lines.push((m.role === 'ta' ? name : '我') + '：' + String(m.text).slice(0, 120));
    });
    return [
      { role: 'system', content: sys },
      { role: 'user', content: '最近的对话：\n' + (lines.join('\n') || '（还没聊过，你先开口打招呼）') + '\n\n请给 3 条候选回复。' }
    ];
  }

  function callAI(messages) {
    var c = cfg();
    var url = String(c.base || '').trim().replace(/\/+$/, '') + '/chat/completions';
    var ctrl = new AbortController();
    var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 30000);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
      body: JSON.stringify({ model: c.model, messages: messages, temperature: 1.0, max_tokens: 500 }),
      signal: ctrl.signal
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        clearTimeout(timer);
        if (!r.ok) {
          var msg = (j && j.error && (j.error.message || j.error)) || ('HTTP ' + r.status);
          throw new Error(String(msg).slice(0, 120));
        }
        var t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!t) throw new Error('返回内容为空');
        return String(t);
      });
    }).catch(function (e) {
      clearTimeout(timer);
      throw (e && e.name === 'AbortError') ? new Error('请求超时') : e;
    });
  }

  function cleanOne(s) {
    return String(s == null ? '' : s)
      .trim()
      .replace(/^[\s"'「『“]+/, '')
      .replace(/["'」』”]+$/, '')
      .replace(/^[①②③1-3][.、)）]\s*/, '')
      .trim();
  }

  // 把模型输出解析成最多 3 条候选（容错：JSON / 数组片段 / 逐行）
  function parse3(raw) {
    var t = String(raw || '').trim();
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    var arr = null;
    try {
      var j = JSON.parse(t);
      if (Array.isArray(j)) arr = j;
      else if (j && Array.isArray(j.replies)) arr = j.replies;
      else if (j && Array.isArray(j.answers)) arr = j.answers;
      else if (j && Array.isArray(j.candidates)) arr = j.candidates;
    } catch (e) {}
    if (!arr) {
      var m = t.match(/\[[\s\S]*\]/);
      if (m) { try { arr = JSON.parse(m[0]); } catch (e) {} }
    }
    if (!Array.isArray(arr)) {
      arr = t.split(/\n+/).map(cleanOne).filter(Boolean);
    }
    arr = arr.map(cleanOne).filter(function (x) { return x && x.length > 1; });
    // 去掉重复/高度相似的候选
    var out = [];
    arr.forEach(function (x) {
      if (!out.some(function (y) { return y === x || (y.length > 8 && x.length > 8 && y.slice(0, 10) === x.slice(0, 10)); })) out.push(x);
    });
    return out.slice(0, 3);
  }

  // ---------- 样式（自注入，不动 css 文件） ----------
  function injectStyle() {
    if (document.getElementById('rc-style')) return;
    var st = document.createElement('style');
    st.id = 'rc-style';
    st.textContent = [
      '.rc-overlay{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;',
      'background:linear-gradient(180deg,#FFFDF9 0%,#FFF7EE 100%);border-radius:44px;overflow:hidden;',
      'color:#3B3128;font-family:inherit;}',
      '.rc-overlay[hidden]{display:none;}',
      '.rc-head{flex:none;display:flex;align-items:center;gap:8px;padding:calc(14px + env(safe-area-inset-top,0px)) 14px 10px;',
      'background:rgba(255,251,245,.92);border-bottom:1px solid rgba(180,150,110,.16);}',
      '.rc-head button{border:0;background:none;padding:4px;font-size:17px;color:#6B5A48;cursor:pointer;}',
      '.rc-ava{width:34px;height:34px;border-radius:50%;flex:none;background:#F3E3CE center/cover no-repeat;',
      'display:flex;align-items:center;justify-content:center;font-size:16px;color:#9A8367;border:1px solid rgba(180,150,110,.25);}',
      '.rc-title{flex:1;min-width:0;line-height:1.25;}',
      '.rc-title b{display:block;font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.rc-title span{display:block;font-size:11px;color:#9A8771;}',
      '.rc-list{flex:1;min-height:0;overflow-y:auto;padding:12px 12px 8px;display:flex;flex-direction:column;gap:10px;}',
      '.rc-row{display:flex;gap:8px;align-items:flex-start;}',
      '.rc-row.me{justify-content:flex-end;}',
      '.rc-row.ta .rc-ava{width:30px;height:30px;font-size:14px;}',
      '.rc-col{max-width:82%;display:flex;flex-direction:column;gap:6px;}',
      '.rc-row.me .rc-col{align-items:flex-end;}',
      '.rc-bubble{padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.5;word-break:break-word;white-space:pre-wrap;}',
      '.rc-row.ta .rc-bubble{background:#FFF1DF;border:1px solid rgba(226,180,120,.34);border-top-left-radius:5px;}',
      '.rc-row.me .rc-bubble{background:#DFF0E4;border:1px solid rgba(120,180,140,.34);border-top-right-radius:5px;}',
      '.rc-meta{font-size:10.5px;color:#A08C74;padding:0 2px;}',
      '.rc-cands{display:flex;flex-direction:column;gap:6px;}',
      '.rc-cand{position:relative;padding:8px 10px 8px 26px;border-radius:12px;font-size:13.5px;line-height:1.45;',
      'background:rgba(255,255,255,.72);border:1px solid rgba(190,165,135,.28);color:#4A3E32;',
      'transition:opacity .35s ease,transform .35s ease,border-color .35s ease,background .35s ease;}',
      '.rc-cand .rc-no{position:absolute;left:8px;top:7px;font-size:11px;color:#A08C74;}',
      '.rc-cand.dim{opacity:.42;transform:scale(.985);}',
      '.rc-cand.dim .rc-tag{display:inline-block;margin-left:6px;font-size:10px;color:#A08C74;}',
      '.rc-cand.chosen{background:#FFF4E3;border-color:#E7B477;box-shadow:0 3px 10px rgba(200,150,90,.18);}',
      '.rc-cand.chosen .rc-tag{display:inline-block;margin-left:6px;font-size:10px;color:#B97A2C;font-weight:700;}',
      '.rc-cand .rc-tag{display:none;}',
      '.rc-note{margin:2px 4px;font-size:11px;color:#9A8771;background:rgba(255,255,255,.6);',
      'border:1px dashed rgba(190,165,135,.4);border-radius:10px;padding:8px 10px;line-height:1.5;}',
      '.rc-typing{flex:none;padding:0 16px 6px;font-size:11.5px;color:#9A8771;}',
      '.rc-typing[hidden]{display:none;}',
      '.rc-inbar{flex:none;display:flex;gap:8px;align-items:flex-end;padding:8px 12px calc(10px + env(safe-area-inset-bottom,0px));',
      'border-top:1px solid rgba(180,150,110,.16);background:rgba(255,252,247,.95);}',
      '.rc-input{flex:1;min-height:38px;max-height:96px;resize:none;border-radius:12px;border:1px solid rgba(190,165,135,.4);',
      'padding:9px 11px;font-size:14px;line-height:1.4;background:#fff;color:#3B3128;font-family:inherit;box-sizing:border-box;}',
      '.rc-input:focus{outline:none;border-color:#E0B27C;}',
      '.rc-send{flex:none;border:0;border-radius:12px;padding:10px 14px;font-size:14px;font-weight:600;',
      'background:#E9B87E;color:#fff;cursor:pointer;}',
      '.rc-send:disabled{opacity:.5;}',
      '.rc-set{position:absolute;inset:0;z-index:3;background:#FFFCF7;overflow-y:auto;padding:16px 16px calc(24px + env(safe-area-inset-bottom,0px));}',
      '.rc-set[hidden]{display:none;}',
      '.rc-set h4{margin:0 0 12px;font-size:15px;font-weight:700;}',
      '.rc-set label{display:block;font-size:11.5px;color:#8B7862;margin:12px 0 4px;}',
      '.rc-set input,.rc-set textarea{width:100%;box-sizing:border-box;border:1px solid rgba(190,165,135,.45);border-radius:10px;',
      'padding:9px 11px;font-size:13.5px;background:#fff;color:#3B3128;font-family:inherit;}',
      '.rc-set textarea{min-height:64px;resize:vertical;line-height:1.5;}',
      '.rc-set .rc-hint{font-size:11px;color:#A08C74;line-height:1.6;margin-top:6px;}',
      '.rc-set .rc-btns{display:flex;gap:10px;margin-top:16px;}',
      '.rc-set .rc-btns button{flex:1;padding:11px;border-radius:10px;font-size:14px;cursor:pointer;}',
      '.rc-set .rc-save{border:0;background:#E9B87E;color:#fff;font-weight:600;}',
      '.rc-set .rc-close{border:1px solid rgba(190,165,135,.5);background:#fff;color:#8B7862;}',
      '.rc-set .rc-test{border:1px solid rgba(190,165,135,.5);background:#FFFDF9;color:#8B7862;}',
      '.rc-status{font-size:11.5px;color:#9A8771;margin-top:10px;min-height:16px;line-height:1.5;}',
      '[data-theme="dark"] .rc-overlay{background:linear-gradient(180deg,#232019,#1D1A15);color:#EDE5DA;}',
      '[data-theme="dark"] .rc-head{background:rgba(35,32,25,.94);border-bottom-color:rgba(255,255,255,.08);}',
      '[data-theme="dark"] .rc-head button{color:#D8CBB8;}',
      '[data-theme="dark"] .rc-ava{background-color:#3A342A;color:#C9B89F;border-color:rgba(255,255,255,.12);}',
      '[data-theme="dark"] .rc-title span,[data-theme="dark"] .rc-meta,[data-theme="dark"] .rc-typing{color:#A99B87;}',
      '[data-theme="dark"] .rc-row.ta .rc-bubble{background:#3A3126;border-color:rgba(226,180,120,.22);}',
      '[data-theme="dark"] .rc-row.me .rc-bubble{background:#2C3A30;border-color:rgba(120,180,140,.2);}',
      '[data-theme="dark"] .rc-cand{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);color:#E9DFD2;}',
      '[data-theme="dark"] .rc-cand.chosen{background:#3D3325;border-color:#C79A62;}',
      '[data-theme="dark"] .rc-note{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.14);color:#B4A591;}',
      '[data-theme="dark"] .rc-inbar{background:rgba(35,32,25,.95);border-top-color:rgba(255,255,255,.08);}',
      '[data-theme="dark"] .rc-input{background:#2B261F;color:#EDE5DA;border-color:rgba(255,255,255,.16);}',
      '[data-theme="dark"] .rc-set{background:#201D17;}',
      '[data-theme="dark"] .rc-set input,[data-theme="dark"] .rc-set textarea{background:#2B261F;color:#EDE5DA;border-color:rgba(255,255,255,.16);}',
      '[data-theme="dark"] .rc-set .rc-close,[data-theme="dark"] .rc-set .rc-test{background:#2B261F;color:#D8CBB8;border-color:rgba(255,255,255,.16);}',
      '.rc-clear{border:1px solid #E2B4B0;background:#FFF6F5;color:#C0504D;font-weight:600;}',
      '[data-theme="dark"] .rc-clear{background:#3A2A28;border-color:#8A524E;color:#E8B4B0;}'
    ].join('');
    document.head.appendChild(st);
  }

  // ---------- DOM 引用 ----------
  var overlay = null;
  var listEl = null;
  var typingEl = null;
  var inputEl = null;
  var sendBtn = null;
  var setPanel = null;
  var busy = false;
  var pendingAnim = [];

  function nameOf() { return partnerName(); }
  function avaHTML() {
    var av = partnerAvatar();
    var nm = nameOf();
    if (av) {
      var safe = String(av).replace(/"/g, '%22').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
      return '<div class="rc-ava" style="background-image:url(\'' + safe + '\')"></div>';
    }
    return '<div class="rc-ava">' + esc(nm.slice(0, 1)) + '</div>';
  }

  function buildOverlay() {
    if (overlay) return;
    injectStyle();
    var phone = document.querySelector('.phone');
    if (!phone) return;

    overlay = document.createElement('div');
    overlay.className = 'rc-overlay';
    overlay.id = 'rc-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="rc-head">' +
        '<button type="button" class="rc-closex" title="返回小屋">‹</button>' +
        avaHTML() +
        '<div class="rc-title"><b>' + esc(nameOf()) + '</b><span>小屋里的悄悄话</span></div>' +
        '<button type="button" class="rc-gear" title="设置">⚙</button>' +
      '</div>' +
      '<div class="rc-list" id="rc-list"></div>' +
      '<div class="rc-typing" id="rc-typing" hidden><b>' + esc(nameOf()) + '</b> 正在想三个答案…</div>' +
      '<div class="rc-inbar">' +
        '<textarea class="rc-input" id="rc-input" rows="1" placeholder="说点什么…"></textarea>' +
        '<button type="button" class="rc-send" id="rc-send">发送</button>' +
      '</div>' +
      '<div class="rc-set" id="rc-set" hidden>' +
        '<h4>AI 设置（只存在这台设备）</h4>' +
        '<label>接口地址 Base URL</label>' +
        '<input id="rc-c-base" type="text" placeholder="https://api.deepseek.com/v1">' +
        '<label>API Key</label>' +
        '<input id="rc-c-key" type="password" placeholder="sk-...">' +
        '<label>模型名</label>' +
        '<input id="rc-c-model" type="text" placeholder="deepseek-chat">' +
        '<label>' + esc(nameOf()) + ' 的人设（可留空）</label>' +
        '<textarea id="rc-c-world" placeholder="例：外冷内热，说话简短，偶尔别扭；你们是住在一起的老朋友"></textarea>' +
        '<div class="rc-hint">兼容 OpenAI 格式的服务都可以：DeepSeek、Kimi、豆包等。没填这三项时，只能在房间里聊天但不能让 TA 说话。</div>' +
        '<div class="rc-btns"><button type="button" class="rc-test" id="rc-c-test">测试连通性</button>' +
        '<button type="button" class="rc-save" id="rc-c-save">保存</button></div>' +
        '<div class="rc-status" id="rc-c-status"></div>' +
        '<div class="rc-btns"><button type="button" class="rc-clear" id="rc-c-clear">清空和 TA 的聊天记录</button></div>' +
        '<div class="rc-btns"><button type="button" class="rc-close" id="rc-c-close">返回对话</button></div>' +
      '</div>';
    phone.appendChild(overlay);

    listEl = overlay.querySelector('#rc-list');
    typingEl = overlay.querySelector('#rc-typing');
    inputEl = overlay.querySelector('#rc-input');
    sendBtn = overlay.querySelector('#rc-send');
    setPanel = overlay.querySelector('#rc-set');

    overlay.querySelector('.rc-closex').addEventListener('click', closeOverlay);
    overlay.querySelector('.rc-gear').addEventListener('click', function () { openSettings(); });
    sendBtn.addEventListener('click', function () { doSend(); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    inputEl.addEventListener('input', function () {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(96, inputEl.scrollHeight) + 'px';
    });
    overlay.querySelector('#rc-c-close').addEventListener('click', function () { setPanel.hidden = true; });
    overlay.querySelector('#rc-c-clear').addEventListener('click', function () {
      if (!confirm('清空和 ' + nameOf() + ' 在小屋里的聊天记录？（只清空当前这个联系人，其他联系人的记录不会受影响，API 配置也不会动）')) return;
      try { localStorage.removeItem(THREAD_PREFIX + myCid()); } catch (e) {}
      setPanel.hidden = true;
      renderThread();
      toast('已清空');
    });
    overlay.querySelector('#rc-c-save').addEventListener('click', function () {
      saveCfg({
        base: overlay.querySelector('#rc-c-base').value.trim(),
        key: overlay.querySelector('#rc-c-key').value.trim(),
        model: overlay.querySelector('#rc-c-model').value.trim(),
        world: overlay.querySelector('#rc-c-world').value.trim()
      });
      setPanel.hidden = true;
      renderThread();
      toast(cfgReady() ? '已保存' : '已保存（三项还没填全）');
    });
    overlay.querySelector('#rc-c-test').addEventListener('click', function () {
      var st = overlay.querySelector('#rc-c-status');
      var base = overlay.querySelector('#rc-c-base').value.trim();
      var key = overlay.querySelector('#rc-c-key').value.trim().replace(/\s/g, ' ');
      var model = overlay.querySelector('#rc-c-model').value.trim();
      if (!base || !key || !model) { st.textContent = '三项都要填才能测试'; st.style.color = '#C0504D'; return; }
      st.textContent = '正在测试…'; st.style.color = '#9A8771';
      var keep = cfg();
      saveCfg({ base: base, key: key, model: model, world: keep.world });
      callAI([{ role: 'user', content: '只回复两个字：你好' }])
        .then(function () { st.textContent = '✓ 连通正常'; st.style.color = '#4E8A55'; })
        .catch(function (e) { saveCfg(keep); st.textContent = '✗ ' + ((e && e.message) || '连接失败'); st.style.color = '#C0504D'; });
    });
  }

  function openSettings() {
    if (!setPanel) return;
    var c = cfg();
    overlay.querySelector('#rc-c-base').value = c.base;
    overlay.querySelector('#rc-c-key').value = c.key;
    overlay.querySelector('#rc-c-model').value = c.model;
    overlay.querySelector('#rc-c-world').value = c.world;
    overlay.querySelector('#rc-c-status').textContent = '';
    setPanel.hidden = false;
  }

  // ---------- 渲染 ----------
  function emptyHintHTML() {
    return '<div class="rc-note">这里是小屋，只有你和 ' + esc(nameOf()) + '。<br>' +
      (cfgReady()
        ? '说一句话，' + esc(nameOf()) + '会一次想三条回答，再从里面挑一条说给你听。'
        : '先在右上角 ⚙ 里填接口地址 / Key / 模型，' + esc(nameOf()) + '才会说话。') +
      '</div>';
  }

  function msgHTML(m, idx) {
    if (m.role === 'me') {
      return '<div class="rc-row me"><div class="rc-col"><div class="rc-bubble">' + esc(m.text) + '</div></div></div>';
    }
    var head = '<div class="rc-row ta" data-i="' + idx + '">' + avaHTML() + '<div class="rc-col">';
    if (m.cands && m.cands.length) {
      var no = ['①', '②', '③'];
      var cands = m.cands.map(function (t, i) {
        var chosen = (i === (m.pick || 0));
        return '<div class="rc-cand ' + (chosen ? 'chosen' : 'dim') + '" data-c="' + i + '">' +
          '<span class="rc-no">' + (no[i] || (i + 1)) + '</span>' + esc(t) +
          '<span class="rc-tag">' + (chosen ? '✓ 选这句' : '没选') + '</span></div>';
      }).join('');
      return head + '<div class="rc-cands">' + cands + '</div>' +
        '<div class="rc-meta">' + esc(nameOf()) + ' 从 3 条里选了 ' + (no[m.pick || 0] || '①') + '</div></div></div>';
    }
    if (m.err) {
      return head + '<div class="rc-note">没接上 AI：' + esc(m.err) + '（检查右上角 ⚙ 设置）</div></div></div>';
    }
    return head + '<div class="rc-bubble">' + esc(m.text) + '</div></div></div>';
  }

  function renderThread() {
    if (!listEl) return;
    var list = loadThread();
    if (!list.length) { listEl.innerHTML = emptyHintHTML(); return; }
    listEl.innerHTML = list.map(msgHTML).join('');
    listEl.scrollTop = listEl.scrollHeight;
    // 入场动画：让「选中」那条先落定，其余淡出
    var rows = listEl.querySelectorAll('.rc-row.ta[data-i]');
    var last = rows[rows.length - 1];
    if (last) {
      var chosen = last.querySelector('.rc-cand.chosen');
      var others = last.querySelectorAll('.rc-cand.dim');
      if (chosen) {
        chosen.style.transform = 'translateY(4px)';
        chosen.style.opacity = '0';
        others.forEach(function (o) { o.style.opacity = '0'; });
        setTimeout(function () {
          chosen.style.transform = 'translateY(0)';
          chosen.style.opacity = '1';
          setTimeout(function () {
            others.forEach(function (o) { o.style.opacity = ''; });
          }, 260);
        }, 40);
      }
    }
  }

  function appendMsg(m) {
    var list = loadThread();
    list.push(m);
    saveThread(list);
    renderThread();
  }

  // ---------- 发送 ----------
  function doSend() {
    if (!inputEl) return;
    var txt = String(inputEl.value || '').trim();
    if (!txt) return;
    if (busy) { toast('等 TA 想完这轮'); return; }
    inputEl.value = '';
    inputEl.style.height = 'auto';
    appendMsg({ role: 'me', text: txt, ts: Date.now() });

    if (!cfgReady()) {
      appendMsg({ role: 'ta', text: '', err: '还没配置 API（右上角 ⚙ 填三项）', ts: Date.now() });
      openSettings();
      return;
    }

    busy = true;
    if (sendBtn) sendBtn.disabled = true;
    if (typingEl) typingEl.hidden = false;
    if (listEl) listEl.scrollTop = listEl.scrollHeight;

    callAI(buildPrompt()).then(function (raw) {
      var cands = parse3(raw);
      if (!cands.length) throw new Error('AI 返回格式看不懂');
      var pick = Math.floor(Math.random() * cands.length);
      if (typingEl) typingEl.hidden = true;
      appendMsg({ role: 'ta', text: cands[pick], cands: cands, pick: pick, ts: Date.now() });
    }).catch(function (e) {
      if (typingEl) typingEl.hidden = true;
      appendMsg({ role: 'ta', text: '', err: (e && e.message) || '请求失败', ts: Date.now() });
    }).then(function () {
      busy = false;
      if (sendBtn) sendBtn.disabled = false;
    });
  }

  // ---------- 开合 ----------
  function openOverlay() {
    buildOverlay();
    if (!overlay) return;
    // 每次打开按当前联系人重建头像/名字（切联系人后房间也可能换人）
    var head = overlay.querySelector('.rc-head');
    if (head) {
      head.querySelector('.rc-ava').outerHTML = avaHTML();
      head.querySelector('.rc-title b').textContent = nameOf();
      var tp = overlay.querySelector('#rc-typing');
      if (tp) tp.innerHTML = '<b>' + esc(nameOf()) + '</b> 正在想三个答案…';
    }
    overlay.hidden = false;
    setPanel.hidden = true;
    renderThread();
    setTimeout(function () { try { inputEl.focus(); } catch (e) {} }, 60);
  }
  function closeOverlay() {
    if (overlay) { overlay.hidden = true; setPanel.hidden = true; }
  }

  // ---------- 入口注入 ----------
  function injectEntry() {
    var bar = document.querySelector('#page-room .r-bar');
    if (!bar || bar.querySelector('#room-btn-chat')) return;
    var b = document.createElement('button');
    b.id = 'room-btn-chat';
    b.type = 'button';
    b.textContent = '聊天';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      openOverlay();
    });
    bar.appendChild(b);
  }

  // ---------- 启动 ----------
  function boot() {
    if (!document.getElementById('page-room')) return;
    injectEntry();
    injectStyle();
    // 房间页被隐藏（返回桌面/聊天）时自动收起浮层
    try {
      var pg = document.getElementById('page-room');
      new MutationObserver(function () {
        if (pg.hidden) closeOverlay();
      }).observe(pg, { attributes: true, attributeFilter: ['hidden'] });
    } catch (e) {}
    // 换联系人时刷新入口层（房间数据按联系人隔离，对话也按联系人隔离）
    try {
      var obs2 = new MutationObserver(function () { if (overlay && !overlay.hidden) openOverlay(); });
      obs2.observe(document.body, { attributes: true, attributeFilter: ['data-cid'] });
    } catch (e) {}
    window.roomChatOpen = openOverlay;
    window.roomChatClose = closeOverlay;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
