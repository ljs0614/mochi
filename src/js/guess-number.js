// ===== 功能：梦角猜数字小游戏（聊天页更多功能 → 猜数字） =====
// 梦角想一个 1-100 的数字，玩家猜，梦角回「大了/小了/对了」。
// 猜中后梦角加一句彩蛋回应。可自定义范围（1-N）。
(function () {
  const panel = document.getElementById('chat-guess-panel');
  if (!panel) return;
  const partnerNameEl = document.getElementById('guess-partner-name');
  const rangeSel = document.getElementById('guess-range');
  const startBtn = document.getElementById('guess-start');
  const inputEl = document.getElementById('guess-input');
  const guessBtn = document.getElementById('guess-btn');
  const msgEl = document.getElementById('guess-msg');
  const countEl = document.getElementById('guess-count');
  const lowEl = document.getElementById('guess-low');
  const highEl = document.getElementById('guess-high');
  const closeBtn = document.getElementById('guess-close');
  const replayBtn = document.getElementById('guess-replay');

  const T = window.taFit || function (x) { return x; };

  // 梦角回应池
  const TA_REPLIES = {
    tooBig: [
      '太大啦😤 往小了猜',
      '大了大了~',
      '这都超了好嘛',
      '笨蛋，小一点',
      '太大啦，再猜猜~'
    ],
    tooSmall: [
      '太小了🥺 往大了猜',
      '小了小了~',
      '这也太小了吧',
      '再大一点嘛',
      '太小啦，加加油~'
    ],
    hit: [
      '猜对啦！🎉 好厉害！',
      '就是这个！你怎么猜到的😳',
      '哇！猜对了！奖励你一个抱抱~',
      '好聪明！猜对了嘛~',
      '天哪真被你猜中了💢'
    ],
    giveUp: [
      '好吧好吧告诉你，是 {num}~',
      '认输认输，其实是 {num}',
      '我直接说吧：{num}！',
      '太难啦，是 {num} 啦'
    ]
  };

  const END_POOLS = {
    lucky: [
      '你好准呀，是不是偷看了😳',
      '猜得好厉害~',
      '再来一局嘛~'
    ],
    normal: [
      '还不错哦~',
      '继续加油！',
      '下次能更少猜吗~'
    ]
  };

  // 状态
  let state = { target: 0, range: 100, count: 0, min: 1, max: 100, playing: false, found: false };

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function setMsg(text, cssClass) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className = 'guess-msg' + (cssClass ? ' ' + cssClass : '');
  }

  function updateRange() {
    if (lowEl) lowEl.textContent = state.min;
    if (highEl) highEl.textContent = state.max;
    if (countEl) countEl.textContent = state.count;
  }

  function startGame() {
    const range = parseInt(rangeSel && rangeSel.value, 10) || 100;
    state.range = range;
    state.target = 1 + Math.floor(Math.random() * range);
    state.count = 0;
    state.min = 1;
    state.max = range;
    state.playing = true;
    state.found = false;

    setMsg(pick([
      '我心里想了一个 1-' + range + ' 的数字，你猜~',
      '好啦！我想好了，猜猜看是多少~',
      '来吧！1 到 ' + range + ' 之间，猜到算你厉害~',
      '想好了想好了，快来猜！'
    ]), 'start');
    updateRange();
    if (inputEl) { inputEl.value = ''; inputEl.disabled = false; inputEl.focus(); }
    if (guessBtn) guessBtn.disabled = false;
    if (replayBtn) replayBtn.hidden = true;
  }

  function submitGuess() {
    if (!state.playing) return;
    const raw = inputEl ? String(inputEl.value || '').trim() : '';
    const n = parseInt(raw, 10);
    if (!n || n < 1 || n > state.range) { setMsg('1 到 ' + state.range + ' 之间的整数哦~', 'err'); return; }
    if (n < state.min || n > state.max) { setMsg('刚才已经排除过 ' + n + ' 啦😤', 'err'); return; }

    state.count++;
    updateRange();

    let reply = '';
    if (n === state.target) {
      reply = pick(TA_REPLIES.hit);
      state.playing = false;
      state.found = true;
      setMsg('🎉 ' + reply + '（共猜了 ' + state.count + ' 次）', 'hit');
      // 发聊天消息
      try {
        if (window.addRec) {
          window.addRec({
            side: 'in', text: '🎉 猜对啦！答案是 ' + state.target + '（你猜了 ' + state.count + ' 次）',
            special: 'guess-hit', nightAllow: true
          });
          const endPool = state.count <= Math.ceil(Math.log2(state.range) + 1) ? END_POOLS.lucky : END_POOLS.normal;
          setTimeout(function () {
            window.addRec({ side: 'in', text: pick(endPool), special: 'guess-end', nightAllow: true });
          }, 1500);
        }
      } catch (e) {}
      if (replayBtn) replayBtn.hidden = false;
      if (inputEl) inputEl.disabled = true;
      if (guessBtn) guessBtn.disabled = true;
    } else if (n > state.target) {
      state.max = n - 1;
      reply = pick(TA_REPLIES.tooBig);
      setMsg('⬇️ ' + reply, 'big');
      try { if (window.addRec) window.addRec({ side: 'in', text: '⬇️ ' + reply, special: 'guess-hint', nightAllow: true }); } catch (e) {}
      updateRange();
      if (inputEl) { inputEl.value = ''; inputEl.focus(); }
    } else {
      state.min = n + 1;
      reply = pick(TA_REPLIES.tooSmall);
      setMsg('⬆️ ' + reply, 'small');
      try { if (window.addRec) window.addRec({ side: 'in', text: '⬆️ ' + reply, special: 'guess-hint', nightAllow: true }); } catch (e) {}
      updateRange();
      if (inputEl) { inputEl.value = ''; inputEl.focus(); }
    }
  }

  function openPanel() {
    if (!panel) return;
    panel.hidden = false;
    state.playing = false;
    state.found = false;
    state.count = 0;
    const range = parseInt(rangeSel && rangeSel.value, 10) || 100;
    state.range = range;
    state.min = 1;
    state.max = range;
    setMsg('点「开始」让我想一个数字~', 'start');
    updateRange();
    if (inputEl) { inputEl.value = ''; inputEl.disabled = true; }
    if (guessBtn) guessBtn.disabled = true;
    if (replayBtn) replayBtn.hidden = true;
    try {
      const s = window.activeStore && window.activeStore();
      const name = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || 'TA';
      if (partnerNameEl) partnerNameEl.textContent = name;
    } catch (e) {}
  }
  function closePanel() { if (panel) panel.hidden = true; }
  window.openGuessPanel = openPanel;
  window.closeGuessPanel = closePanel;

  // ---- 绑定 ----
  if (startBtn) startBtn.addEventListener('click', startGame);
  if (guessBtn) guessBtn.addEventListener('click', submitGuess);
  if (inputEl) inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitGuess(); } });
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  if (replayBtn) replayBtn.addEventListener('click', startGame);

  // 聊天消息渲染（special:'guess-hit'/'guess-hint'/'guess-end'）走 msg-pong-card 样式
})();
