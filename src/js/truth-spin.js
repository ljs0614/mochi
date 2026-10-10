// ===== 功能：真心话转盘小游戏（聊天页更多功能 → 真心话转盘） =====
// 转盘转出一个真心话问题 → 玩家回答 → 梦角追问 → 结束后写聊天记录 + 梦角随机回应。
// 题库分"温柔/甜蜜/深度/刺激"四档，各有预设题 + 可自定义追加。
// 追问 = 梦角基于你答的那道题，从对应追问池里随机抽一句互动。
(function () {
  const panel = document.getElementById('chat-truth-panel');
  if (!panel) return;
  const partnerNameEl = document.getElementById('truth-partner-name');
  const wheelEl = document.getElementById('truth-wheel');
  const wheelInner = document.getElementById('truth-wheel-inner');
  const pointerEl = document.getElementById('truth-pointer');
  const resultEl = document.getElementById('truth-result');
  const answerEl = document.getElementById('truth-answer');
  const answerInput = document.getElementById('truth-answer-input');
  const answerBtn = document.getElementById('truth-answer-btn');
  const nextBtn = document.getElementById('truth-next-btn');
  const stopBtn = document.getElementById('truth-stop-btn');
  const closeBtn = document.getElementById('truth-close');
  const catSel = document.getElementById('truth-cat');
  const addQuestionBtn = document.getElementById('truth-add-q');
  const addQuestionInput = document.getElementById('truth-add-q-input');
  const addQuestionConfirm = document.getElementById('truth-add-q-confirm');

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function escG(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }

  // ---- 预设题库（四档） ----
  const PRESETS = {
    gentle: [
      '你第一次见我时心里想的是什么？',
      '你最喜欢我哪一点？',
      '你觉得我最可爱的瞬间是什么时候？',
      '你最想对我说的一句话是什么？',
      '你最想和我一起做什么？',
      '你最想带我去哪个地方？',
      '你最想给我买什么礼物？',
      '你最想为我做一件什么事？'
    ],
    sweet: [
      '你说过的哪句话最让我心动？（你自己觉得）',
      '如果给我起一个专属昵称，你会叫我什么？',
      '你最想让我穿什么样的衣服？',
      '你最想和我拍什么样的合照？',
      '你最想收到我送的什么礼物？',
      '你最想让我在你身上留下什么印记？',
      '你最想对我说哪三句话？',
      '你觉得我们最默契的瞬间是什么？'
    ],
    deep: [
      '如果明天我消失了，你会做什么？',
      '如果我失忆了，你最想帮我记起哪件事？',
      '你觉得我们的关系最怕什么？',
      '你对我们的未来有什么期待？',
      '如果可以回到过去，你最想和我重来哪一天？',
      '你觉得我最需要改进的地方是什么？',
      '你有什么事一直没告诉我？',
      '如果我们分开了，你会留着我的什么东西？'
    ],
    spicy: [
      '你最想对我做什么？',
      '你最想让我对你做什么？',
      '你最想和我在哪个地方独处？',
      '你最想让我穿什么给你看？',
      '你最想让我对你说什么悄悄话？',
      '你最想和我玩什么游戏？',
      '你最想让我怎么叫你？',
      '你最想和我去哪里旅行？'
    ]
  };

  const CATS = [
    { k: 'gentle', name: '温柔', color: '#E8F4FD', text: '#3B82F6' },
    { k: 'sweet',  name: '甜蜜', color: '#FEF3C7', text: '#D97706' },
    { k: 'deep',   name: '深度', color: '#EDE9FE', text: '#7C3AED' },
    { k: 'spicy',  name: '刺激', color: '#FEE2E2', text: '#DC2626' }
  ];

  // 梦角追问池（按分类）
  const FOLLOWUPS = {
    gentle: ['真的吗😳', '我也觉得~', '好感动🥺', '继续说~', '我想听更多'],
    sweet:  ['哎呀好害羞💢', '真的假的😳', '那你什么时候带我去~', '我也想~', '再说一遍嘛~'],
    deep:   ['...', '我也是这么想的', '别离开我好吗', '我会一直陪着你的', '我不会让你消失的'],
    spicy:  ['😳', '哼，你好坏💢', '那你敢吗', '我才不要告诉你', '你想什么呢笨蛋']
  };

  // 梦角游戏结束回应
  const END_POOLS = {
    gentle: ['今天好温柔呀~', '谢谢你愿意告诉我这些', '我也爱你~'],
    sweet:  ['甜死了🥺', '好喜欢你这样', '再来一局嘛~'],
    deep:   ['...我们一起走下去吧', '不会让你一个人的', '我也在'],
    spicy:  ['你真的好大胆💢', '哼，今天就到这！', '再玩我就真害羞了~']
  };

  // ---- 存储：自定义追加的问题 ----
  function customKey(cat) { return prefix() + ':truth-custom:' + cat; }
  function loadCustom(cat) {
    try {
      const a = JSON.parse(localStorage.getItem(customKey(cat)) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function saveCustom(cat, arr) {
    try { localStorage.setItem(customKey(cat), JSON.stringify(arr)); } catch (e) {}
  }

  // ---- 状态 ----
  let state = { phase: 'idle', currentQ: '', currentCat: '', answered: false, spinDeg: 0 };

  // ---- 渲染转盘 ----
  function buildWheelHTML() {
    const cat = CATS.find(c => c.k === (catSel && catSel.value) || 'gentle');
    const catQuestions = [...PRESETS[cat.k], ...loadCustom(cat.k)];
    const N = Math.min(catQuestions.length, 8); // 最多8格
    const degPer = 360 / N;
    let html = '';
    for (let i = 0; i < N; i++) {
      const start = i * degPer - 90; // 从顶部开始
      const end = start + degPer;
      const clip = `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.cos((start * Math.PI) / 180)}% ${50 + 50 * Math.sin((start * Math.PI) / 180)}%, ${50 + 50 * Math.cos((end * Math.PI) / 180)}% ${50 + 50 * Math.sin((end * Math.PI) / 180)}%)`;
      html += '<div class="tw-seg" style="clip-path:' + clip + ';background:' + cat.color + ';border-color:' + cat.text + '"></div>';
      // 标签文字
      const mid = start + degPer / 2;
      const textDeg = mid + 90;
      html += '<div class="tw-label" style="transform:rotate(' + textDeg + 'deg) translate(0,-62px);color:' + cat.text + '">' + (i + 1) + '</div>';
    }
    return html;
  }

  function rebuildWheel() {
    if (!wheelInner) return;
    wheelInner.innerHTML = buildWheelHTML();
    wheelInner.style.transform = 'rotate(0deg)';
    wheelInner.style.transition = 'none';
  }

  // ---- 开始旋转 ----
  function spin() {
    const cat = CATS.find(c => c.k === (catSel && catSel.value) || 'gentle');
    const catQuestions = [...PRESETS[cat.k], ...loadCustom(cat.k)];
    const N = Math.min(catQuestions.length, 8);
    if (!catQuestions.length) { toast('这一档还没有问题~'); return; }

    // 随机选一个问题
    const pick = Math.floor(Math.random() * catQuestions.length);
    state.currentQ = catQuestions[pick];
    state.currentCat = cat.k;
    state.answered = false;

    // 旋转到对应格子的中心
    const degPer = 360 / N;
    const segIdx = pick % N;
    const target = segIdx * degPer + degPer / 2;
    // 加随机多转几圈 + 微调
    const extraTurns = 4 + Math.floor(Math.random() * 3);
    const jitter = (Math.random() - 0.5) * (degPer * 0.6);
    const newDeg = state.spinDeg + 360 * extraTurns + (360 - target) + jitter;

    state.spinDeg = newDeg;
    state.phase = 'spinning';

    wheelInner.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.25, 1)';
    wheelInner.style.transform = 'rotate(' + newDeg + 'deg)';

    // 结果区先藏起来
    if (resultEl) resultEl.hidden = true;
    if (answerEl) answerEl.hidden = true;

    // 旋转结束显示问题
    setTimeout(function () {
      state.phase = 'answer';
      if (resultEl) {
        resultEl.hidden = false;
        resultEl.querySelector('.tr-q-text').textContent = state.currentQ;
      }
      if (answerEl) answerEl.hidden = false;
      if (answerInput) { answerInput.value = ''; answerInput.focus(); }
    }, 4200);
  }

  // ---- 提交回答 → 梦角追问 ----
  function submitAnswer() {
    const ans = answerInput ? String(answerInput.value || '').trim() : '';
    if (!ans) { toast('说点什么嘛~'); return; }
    state.answered = true;

    // 禁用输入
    if (answerBtn) answerBtn.disabled = true;
    if (answerInput) { answerInput.disabled = true; answerInput.blur(); }

    // 梦角追问
    const cat = CATS.find(c => c.k === state.currentCat) || CATS[0];
    const pool = FOLLOWUPS[cat.k] || FOLLOWUPS.gentle;
    const follow = pool[Math.floor(Math.random() * pool.length)];
    const name = (window.activeStore && window.activeStore() && window.activeStore().get('lbl-partner')) || 'TA';

    // 往聊天里发：你答了 + 梦角追问
    try {
      if (window.addRec) {
        window.addRec({
          side: 'out', text: '真心话 · ' + cat.name + '档\nQ：' + state.currentQ + '\nA：' + ans,
          special: 'truth', nightAllow: true
        });
        setTimeout(function () {
          window.addRec({
            side: 'in', text: follow, special: 'truth-reply', nightAllow: true
          });
        }, 1200);
      }
    } catch (e) {}

    toast(name + '回应：' + follow);

    // 显示下一局按钮
    if (nextBtn) nextBtn.hidden = false;
    if (stopBtn) stopBtn.hidden = false;
    if (answerEl) answerEl.hidden = true;
  }

  function nextRound() {
    state.phase = 'idle';
    state.currentQ = '';
    state.answered = false;
    if (resultEl) resultEl.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
    if (stopBtn) stopBtn.hidden = true;
    if (answerBtn) answerBtn.disabled = false;
    if (answerInput) { answerInput.disabled = false; answerInput.value = ''; }
  }

  function endGame() {
    // 梦角说句结束语
    const cat = CATS.find(c => c.k === state.currentCat) || CATS[0];
    const pool = END_POOLS[cat.k] || END_POOLS.gentle;
    const endMsg = pool[Math.floor(Math.random() * pool.length)];
    try {
      if (window.addRec) {
        window.addRec({ side: 'in', text: endMsg, special: 'truth-end', nightAllow: true });
      }
    } catch (e) {}
    toast('结束啦~ ' + endMsg);
    nextRound();
  }

  // ---- 自定义问题 ----
  function addCustomQuestion() {
    const cat = CATS.find(c => c.k === (catSel && catSel.value) || 'gentle');
    const inp = addQuestionInput;
    if (!inp) return;
    const q = String(inp.value || '').trim();
    if (!q) { toast('写个问题先~'); return; }
    const list = loadCustom(cat.k);
    list.push(q);
    saveCustom(cat.k, list);
    toast('已加到「' + cat.name + '」档');
    inp.value = '';
    rebuildWheel();
  }

  // ---- 打开/关闭 ----
  function openPanel() {
    if (!panel) return;
    panel.hidden = false;
    state.phase = 'idle';
    state.spinDeg = 0;
    rebuildWheel();
    try {
      const s = window.activeStore && window.activeStore();
      const name = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || 'TA';
      if (partnerNameEl) partnerNameEl.textContent = name;
    } catch (e) {}
    if (resultEl) resultEl.hidden = true;
    if (answerEl) answerEl.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
    if (stopBtn) stopBtn.hidden = true;
    if (answerBtn) answerBtn.disabled = false;
    if (answerInput) { answerInput.disabled = false; answerInput.value = ''; }
  }
  function closePanel() { if (panel) panel.hidden = true; }
  window.openTruthPanel = openPanel;
  window.closeTruthPanel = closePanel;

  // ---- 事件绑定 ----
  if (pointerEl) pointerEl.addEventListener('click', spin);
  if (answerBtn) answerBtn.addEventListener('click', submitAnswer);
  if (answerInput) answerInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitAnswer(); } });
  if (nextBtn) nextBtn.addEventListener('click', nextRound);
  if (stopBtn) stopBtn.addEventListener('click', endGame);
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  if (catSel) catSel.addEventListener('change', function () {
    state.spinDeg = 0;
    rebuildWheel();
    if (resultEl) resultEl.hidden = true;
    if (answerEl) answerEl.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
    if (stopBtn) stopBtn.hidden = true;
  });
  if (addQuestionConfirm) addQuestionConfirm.addEventListener('click', addCustomQuestion);

  // 关闭其他面板的委托（复用 more-* 面板关闭逻辑）
  document.addEventListener('click', function (e) {
    if (e.target === pointerEl || e.target === wheelInner || (wheelInner && wheelInner.contains(e.target))) return;
  });

  // 聊天消息渲染（special:'truth'/'truth-reply'/'truth-end'）
  // 走 chat.js 已有的 msg-pong-card 样式（和其他小游戏结算卡片一致）
})();
