/* ============================================================
   Dansk Drill — app logic. Vanilla JS, no build step.
   Card data comes from data.js as the global CARDS.
   ============================================================ */

'use strict';

/* ---------------- storage ---------------- */

const LS_KEY = 'danskdrill.v1';

const defaultStore = () => ({
  phonetics: {},   // cardId -> edited phonetic string
  history: [],     // { date, label, right, wrong, total }
  misses: {},      // cardId -> times marked wrong
});

// Saved data is only trusted for its shape: anything odd falls back to empty,
// so one bad value can't stop the app from starting.
const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

let store = load();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultStore();
    const d = JSON.parse(raw);
    return {
      phonetics: asMap(d && d.phonetics),
      history: Array.isArray(d && d.history) ? d.history : [],
      misses: asMap(d && d.misses),
    };
  } catch (e) {
    // Keep the unreadable copy so the next save can't silently destroy it.
    try { localStorage.setItem(LS_KEY + '.unreadable', localStorage.getItem(LS_KEY)); } catch (e2) { /* ignore */ }
    console.warn('Could not read saved data, starting fresh. A copy is kept under', LS_KEY + '.unreadable', e);
    return defaultStore();
  }
}

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('Could not save.', e);
  }
}

/* ---------------- helpers ---------------- */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const TYPE_LABEL = {
  flip: 'Flip',
  conjugate: 'Conjugate',
  reorder: 'Reorder',
  sentence: 'Sentence',
};

/* Answer matching for Conjugate cards.
   Case-insensitive, punctuation-light, and deliberately forgiving about
   Danish special characters — typing å/ø/æ on a normal keyboard is friction,
   not the point of the drill. We build a small set of folded forms for each
   string and count it a match if any form is shared. */
function forms(raw) {
  const base = String(raw)
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:"']/g, '')
    .replace(/\s+/g, ' ');

  const digraph = base.replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa');
  const bare = base.replace(/æ/g, 'a').replace(/ø/g, 'o').replace(/å/g, 'a');
  const squashed = bare.replace(/([a-zæøå])\1+/g, '$1');

  return new Set([base, digraph, bare, squashed]);
}

function answerMatches(typed, accepted) {
  const mine = forms(typed);
  if (!String(typed).trim()) return false;
  return accepted.some((ans) => {
    for (const f of forms(ans)) if (mine.has(f)) return true;
    return false;
  });
}

/* Text inputs: phone keyboards "fix" Danish words into English, so switch
   autocorrect, auto-capitalising and spellcheck off for typed answers. */
function plainInput(node) {
  node.setAttribute('autocorrect', 'off');
  node.setAttribute('autocapitalize', 'none');
  node.autocomplete = 'off';
  node.spellcheck = false;
  return node;
}

/* Word-level helpers for Reorder: the closing . or ? is dropped (it is never a
   tile and never graded), commas stay on their word for the tiles but are
   ignored when comparing, and Danish letters fold the same way as Conjugate. */
function words(sentence) {
  return String(sentence).trim().replace(/[.?!]+$/, '').split(/\s+/).filter(Boolean);
}
function sameWord(a, b) {
  if (a == null || b == null) return false;
  const fb = forms(b);
  for (const f of forms(a)) if (fb.has(f)) return true;
  return false;
}
function sameWords(a, b) {
  return a.length === b.length && a.every((w, i) => sameWord(w, b[i]));
}

/* ---------------- derived card info ---------------- */

const CATEGORIES = (() => {
  const map = new Map();
  CARDS.forEach((c) => {
    if (!map.has(c.category)) map.set(c.category, { name: c.category, cards: [], types: new Set() });
    const entry = map.get(c.category);
    entry.cards.push(c);
    entry.types.add(c.type);
  });
  return [...map.values()].sort((a, b) => b.cards.length - a.cards.length);
})();

const TYPES = (() => {
  const map = new Map();
  CARDS.forEach((c) => {
    if (!map.has(c.type)) map.set(c.type, []);
    map.get(c.type).push(c);
  });
  return ['flip', 'conjugate', 'reorder', 'sentence']
    .filter((t) => map.has(t))
    .map((t) => ({ type: t, cards: map.get(t) }));
})();

const byId = new Map(CARDS.map((c) => [c.id, c]));

/* ---------------- session state ---------------- */

let session = null;

function startSession(cards, label) {
  if (!cards.length) return;
  session = {
    label,
    queue: shuffle(cards),
    i: 0,
    right: 0,
    wrong: 0,
    results: [],   // { card, correct }
  };
  show('session');
  renderCard();
}

function grade(correct) {
  const card = session.queue[session.i];
  session.results.push({ card, correct });
  if (correct) {
    session.right++;
    if (store.misses[card.id]) {
      delete store.misses[card.id];
      save();
    }
  } else {
    session.wrong++;
    store.misses[card.id] = (store.misses[card.id] || 0) + 1;
    save();
  }
  session.i++;
  if (session.i >= session.queue.length) finishSession();
  else renderCard();
}

function finishSession() {
  const { right, wrong, label, results } = session;
  const total = right + wrong;
  store.history.unshift({
    date: new Date().toISOString(),
    label,
    right,
    wrong,
    total,
  });
  store.history = store.history.slice(0, 60);
  save();

  $('#results-title').textContent = label;
  $('#r-right').textContent = right;
  $('#r-total').textContent = total;
  $('#r-pct').textContent = total ? `${Math.round((right / total) * 100)}% correct` : '';

  // breakdown by card type
  const bd = $('#r-breakdown');
  bd.innerHTML = '';
  const byType = new Map();
  results.forEach((r) => {
    const k = r.card.type;
    if (!byType.has(k)) byType.set(k, { right: 0, total: 0 });
    const e = byType.get(k);
    e.total++;
    if (r.correct) e.right++;
  });
  [...byType.entries()].forEach(([type, e]) => {
    const row = el('div', 'bd-row');
    row.appendChild(el('span', 'bd-name', TYPE_LABEL[type] || type));
    const track = el('div', 'bd-track');
    const fill = el('div', 'bd-fill');
    fill.style.width = `${(e.right / e.total) * 100}%`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'bd-num', `${e.right}/${e.total}`));
    bd.appendChild(row);
  });

  // list of misses
  const missWrap = $('#r-missed');
  missWrap.innerHTML = '';
  const missed = results.filter((r) => !r.correct);
  if (missed.length) {
    missWrap.appendChild(el('h3', null, `Missed (${missed.length})`));
    missed.forEach((r) => {
      const item = el('div', 'missed-item');
      const b = el('b', null, promptOf(r.card));
      item.appendChild(b);
      item.appendChild(document.createTextNode(' — ' + answerOf(r.card)));
      missWrap.appendChild(item);
    });
  }

  $('#btn-retry-missed').disabled = missed.length === 0;
  show('results');
}

function promptOf(card) {
  if (card.type === 'flip') return card.front;
  if (card.type === 'conjugate') return card.prompt;
  if (card.type === 'reorder') return card.translation;
  return card.prompt;
}

function answerOf(card) {
  if (card.type === 'flip') return card.back;
  if (card.type === 'conjugate') return card.acceptedAnswers[0];
  if (card.type === 'reorder') return card.sentence;
  return card.modelAnswer;
}

/* ---------------- card rendering ---------------- */

// A card that sets up something long-lived (the drag-and-drop manager) leaves
// its cleanup here; it runs before the next card renders or the screen changes.
let cardCleanup = null;
function runCardCleanup() {
  if (cardCleanup) { cardCleanup(); cardCleanup = null; }
}

function renderCard() {
  runCardCleanup();
  const card = session.queue[session.i];
  const n = session.queue.length;

  $('#pos').textContent = session.i + 1;
  $('#len').textContent = n;
  $('#progress-fill').style.width = `${(session.i / n) * 100}%`;
  $('#score-right').textContent = session.right;
  $('#score-wrong').textContent = session.wrong;

  const host = $('#card-host');
  host.innerHTML = '';

  const wrap = el('div', 'card');
  const head = el('div', 'card-head');
  head.appendChild(el('span', 'tag type', TYPE_LABEL[card.type]));
  head.appendChild(el('span', 'tag', card.category));
  wrap.appendChild(head);

  ({
    flip: renderFlip,
    conjugate: renderConjugate,
    reorder: renderReorder,
    sentence: renderSentence,
  })[card.type](wrap, card);

  host.appendChild(wrap);
}

/* ---- 1. Flip: self-graded ---- */
function renderFlip(wrap, card) {
  wrap.appendChild(el('p', 'instruction', 'Say your answer out loud, then flip.'));
  wrap.appendChild(el('p', 'prompt da', card.front));

  const actions = el('div', 'actions');
  const flipBtn = el('button', 'act primary');
  flipBtn.innerHTML = 'Flip<span class="kbd">space</span>';
  actions.appendChild(flipBtn);
  wrap.appendChild(actions);

  const reveal = () => {
    actions.remove();
    const block = el('div', 'answer-block');
    block.appendChild(el('div', 'divider'));
    block.appendChild(el('div', 'label', 'Answer'));
    block.appendChild(el('p', 'answer', card.back));

    if (card.examples && card.examples.length) {
      const ul = el('ul', 'examples');
      card.examples.forEach((ex) => {
        const li = el('li');
        li.innerHTML = formatExample(ex);
        ul.appendChild(li);
      });
      block.appendChild(ul);
    }

    if (card.note) block.appendChild(el('div', 'note', card.note));

    // Editable phonetic field — vocab cards only.
    if (card.phonetic != null) {
      const row = el('div', 'phonetic-row');
      const lab = el('div', 'label', 'Pronunciation (editable)');
      const edited = store.phonetics[card.id] != null;
      if (edited) lab.appendChild(el('span', 'edited-flag', 'edited'));
      row.appendChild(lab);
      const input = el('input');
      input.type = 'text';
      input.value = edited ? store.phonetics[card.id] : card.phonetic;
      input.addEventListener('input', () => {
        const v = input.value;
        if (v === card.phonetic) delete store.phonetics[card.id];
        else store.phonetics[card.id] = v;
        save();
      });
      row.appendChild(input);
      block.appendChild(row);
    }

    const grades = el('div', 'actions');
    const good = el('button', 'act good');
    good.innerHTML = 'Got it<span class="kbd">1</span>';
    const bad = el('button', 'act bad');
    bad.innerHTML = 'Missed it<span class="kbd">2</span>';
    good.addEventListener('click', () => grade(true));
    bad.addEventListener('click', () => grade(false));
    grades.appendChild(good);
    grades.appendChild(bad);
    block.appendChild(grades);

    wrap.appendChild(block);
    setKeys({ '1': () => grade(true), '2': () => grade(false) });
  };

  flipBtn.addEventListener('click', reveal);
  setKeys({ ' ': reveal, Enter: reveal });
}

/* Wrap the Danish half of "Danish (English)" examples in <em>. */
function formatExample(ex) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const m = String(ex).match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (m) return `<em>${esc(m[1])}</em> &mdash; ${esc(m[2])}`;
  return `<em>${esc(ex)}</em>`;
}

/* ---- 2. Conjugate: auto-graded, free text ---- */
function renderConjugate(wrap, card) {
  wrap.appendChild(el('p', 'instruction', 'Type the form. Special characters are optional.'));
  wrap.appendChild(el('p', 'prompt da', card.prompt));

  const input = plainInput(el('input', 'type-in'));
  input.type = 'text';
  input.placeholder = 'your answer';
  wrap.appendChild(input);

  const actions = el('div', 'actions');
  const submit = el('button', 'act primary');
  submit.innerHTML = 'Check<span class="kbd">enter</span>';
  actions.appendChild(submit);
  wrap.appendChild(actions);

  let done = false;
  const check = () => {
    if (done) return;
    const typed = input.value;
    if (!typed.trim()) return;
    done = true;
    const correct = answerMatches(typed, card.acceptedAnswers);
    input.disabled = true;
    actions.remove();

    const block = el('div', 'answer-block');
    const v = el('div', `verdict ${correct ? 'right' : 'wrong'}`);
    v.appendChild(el('span', 'verdict-mark', correct ? '✓' : '✗'));
    const body = el('div', 'verdict-body');
    if (!correct) {
      const you = el('div', 'verdict-you');
      you.appendChild(document.createTextNode('You typed '));
      const s = el('s', null, typed.trim());
      you.appendChild(s);
      body.appendChild(you);
    }
    body.appendChild(el('div', 'verdict-correct', card.acceptedAnswers[0]));
    if (card.acceptedAnswers.length > 1) {
      body.appendChild(el('div', 'alt-answers', 'also fine: ' + card.acceptedAnswers.slice(1).join(', ')));
    }
    v.appendChild(body);
    block.appendChild(v);

    // Always reinforce the form in context, right or wrong.
    const ul = el('ul', 'examples');
    const li = el('li');
    li.innerHTML = formatExample(`${card.exampleSentence} (${card.exampleTranslation})`);
    ul.appendChild(li);
    block.appendChild(ul);

    if (card.note) block.appendChild(el('div', 'note', card.note));

    const next = el('div', 'actions');
    const nb = el('button', 'act primary');
    nb.innerHTML = 'Next<span class="kbd">enter</span>';
    nb.addEventListener('click', () => grade(correct));
    next.appendChild(nb);
    block.appendChild(next);
    wrap.appendChild(block);

    setKeys({ Enter: () => grade(correct) });
    nb.focus();
  };

  submit.addEventListener('click', check);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); check(); }
  });
  setKeys({});
  input.focus();
}

/* ---- 3. Reorder: tap words into order ---- */
/* Which words line up between an answer and the reference? Same length: compare
   position by position, so a swapped pair shows up as two wrong words. Different
   length (a word missing or extra): use the longest common run of words, so one
   missing word doesn't turn everything after it red. */
function wordMarks(user, ref) {
  if (user.length === ref.length) {
    const ok = user.map((w, i) => sameWord(w, ref[i]));
    return { userOk: ok, refOk: ok.slice() };
  }
  const n = user.length, m = ref.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = sameWord(user[i], ref[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const userOk = new Array(n).fill(false), refOk = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (sameWord(user[i], ref[j])) { userOk[i] = refOk[j] = true; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return { userOk, refOk };
}

function renderReorder(wrap, card) {
  const instr = el('p', 'instruction');
  wrap.appendChild(instr);
  wrap.appendChild(el('p', 'prompt en', card.translation));
  if (card.startWith) wrap.appendChild(el('p', 'prompt-sub', `Start with: ${card.startWith}`));
  const stage = el('div', 'reorder-stage');
  wrap.appendChild(stage);

  // Words only: the closing . or ? is never a tile and never graded.
  const correct = words(card.sentence);
  const alts = (card.altSentences || []).map(words);
  const refs = [correct, ...alts];
  const matchOf = (ws) => refs.find((r) => sameWords(ws, r));

  let done = false;
  let sawBlocks = false;
  let typedText = '';
  let teardown = () => {};

  // Block state lives here so switching modes back and forth keeps your tiles.
  let tokens = shuffle(correct);
  let guard = 0;
  while (correct.length > 2 && sameWords(tokens, correct) && guard++ < 30) tokens = shuffle(correct);
  let items = { tray: [], bank: tokens.map((_, i) => i) };

  /* ---------- typing mode (default) ---------- */
  function showTyping() {
    teardown();
    stage.innerHTML = '';
    instr.textContent = 'Type the sentence in Danish. Special characters are optional.';

    const input = plainInput(el('input', 'type-in'));
    input.type = 'text';
    input.placeholder = 'type the sentence';
    input.value = typedText;
    stage.appendChild(input);

    const actions = el('div', 'actions');
    const submit = el('button', 'act primary');
    submit.innerHTML = 'Check<span class="kbd">enter</span>';
    const toggle = el('button', 'act');
    toggle.innerHTML = 'Show me the blocks<span class="kbd">ctrl+b</span>';
    actions.appendChild(submit);
    actions.appendChild(toggle);
    stage.appendChild(actions);

    const check = () => {
      if (done || !input.value.trim()) return;
      const typed = words(input.value);
      const ref = matchOf(typed);
      finish(!!ref, typed, ref || correct);
    };

    input.addEventListener('input', () => { typedText = input.value; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); check(); }
      if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); showBlocks(); }
    });
    submit.addEventListener('click', check);
    toggle.addEventListener('click', showBlocks);
    setKeys({ Enter: check, b: showBlocks });
    teardown = () => {};
    setTimeout(() => input.focus(), 0);
  }

  /* ---------- blocks mode (fallback) ---------- */
  function showBlocks() {
    if (done) return;
    teardown();
    sawBlocks = true;
    stage.innerHTML = '';
    instr.textContent = 'Tap or drag the words into order. Drag to rearrange.';

    const tray = el('div', 'build-tray empty');
    const tools = el('div', 'tok-tools');
    const undo = el('button', 'mini-btn', 'Undo');
    const reset = el('button', 'mini-btn', 'Reset');
    tools.appendChild(undo);
    tools.appendChild(reset);
    const bank = el('div', 'word-bank');
    const actions = el('div', 'actions');
    const submit = el('button', 'act primary');
    submit.innerHTML = 'Check<span class="kbd">enter</span>';
    const toggle = el('button', 'act');
    toggle.innerHTML = 'Back to typing<span class="kbd">ctrl+b</span>';
    actions.appendChild(submit);
    actions.appendChild(toggle);
    stage.appendChild(tray);
    stage.appendChild(tools);
    stage.appendChild(bank);
    stage.appendChild(actions);

    const manager = new DndKit.DragDropManager();
    let sortables = [];
    let justDragged = false;
    new DndKit.Droppable({ id: 'tray', element: tray, type: 'column', accept: 'tok', collisionPriority: 0 }, manager);
    new DndKit.Droppable({ id: 'bank', element: bank, type: 'column', accept: 'tok', collisionPriority: 0 }, manager);

    manager.monitor.addEventListener('dragend', (event) => {
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 0);
      if (event.canceled || done) { paint(); return; }
      items = DndKit.move(items, event);
      items.bank.sort((a, b) => a - b);   // bank keeps its shuffled order
      paint();
    });

    function makeTile(idx, group, pos) {
      const t = el('button', group === 'tray' ? 'tok placed' : 'tok', tokens[idx]);
      t.addEventListener('click', () => {
        if (done || justDragged) return;
        if (group === 'bank') {
          items.bank = items.bank.filter((i) => i !== idx);
          items.tray.push(idx);
        } else {
          items.tray = items.tray.filter((i) => i !== idx);
          items.bank.push(idx);
          items.bank.sort((a, b) => a - b);
        }
        paint();
      });
      sortables.push(new DndKit.Sortable({ id: idx, index: pos, group, type: 'tok', accept: 'tok', element: t }, manager));
      return t;
    }

    function paint() {
      sortables.forEach((s) => s.destroy());
      sortables = [];
      tray.innerHTML = '';
      bank.innerHTML = '';
      tray.classList.toggle('empty', items.tray.length === 0);
      items.tray.forEach((idx, pos) => tray.appendChild(makeTile(idx, 'tray', pos)));
      items.bank.forEach((idx, pos) => bank.appendChild(makeTile(idx, 'bank', pos)));
    }

    undo.addEventListener('click', () => {
      if (done || !items.tray.length) return;
      items.bank.push(items.tray.pop());
      items.bank.sort((a, b) => a - b);
      paint();
    });
    reset.addEventListener('click', () => {
      if (done) return;
      items = { tray: [], bank: tokens.map((_, i) => i) };
      paint();
    });

    const check = () => {
      if (done || items.bank.length) return;
      const built = items.tray.map((i) => tokens[i]);
      const ref = matchOf(built);
      finish(!!ref, built, ref || correct);
    };

    // Going back to typing carries over whatever is in the tray.
    const back = () => {
      if (done) return;
      if (items.tray.length) typedText = items.tray.map((i) => tokens[i]).join(' ');
      showTyping();
    };

    submit.addEventListener('click', check);
    toggle.addEventListener('click', back);
    setKeys({ Enter: check, b: back });
    teardown = () => {
      sortables.forEach((s) => s.destroy());
      sortables = [];
      manager.destroy();
      teardown = () => {};
    };
    cardCleanup = () => teardown();
    paint();
  }

  /* ---------- verdict ---------- */
  function finish(isRight, user, ref) {
    done = true;
    teardown();
    stage.innerHTML = '';
    const { userOk, refOk } = wordMarks(user, ref);

    // Your answer, word by word: green = right, red = wrong.
    const row = el('div', `build-tray ${isRight ? 'right' : 'wrong'}`);
    user.forEach((w, i) => row.appendChild(el('span', `tok ${userOk[i] ? 'mark-ok' : 'mark-no'}`, w)));
    stage.appendChild(row);

    const block = el('div', 'answer-block');
    const v = el('div', `verdict ${isRight ? 'right' : 'wrong'} wordwise`);
    v.appendChild(el('span', 'verdict-mark', isRight ? '✓' : '✗'));
    const body = el('div', 'verdict-body');

    // The correct sentence, with the words you missed in red so they line up
    // with the red tiles above.
    const sentence = el('div', 'verdict-correct');
    if (isRight) {
      sentence.textContent = card.sentence;
    } else {
      const end = (card.sentence.trim().match(/[.?!]+$/) || [''])[0];
      correct.forEach((w, i) => {
        if (i) sentence.appendChild(document.createTextNode(' '));
        sentence.appendChild(el('span', refOk[i] ? 'w' : 'w miss', w));
      });
      sentence.appendChild(document.createTextNode(end));
    }
    body.appendChild(sentence);
    body.appendChild(el('div', 'alt-answers', card.translation));
    if (card.altSentences && card.altSentences.length) {
      body.appendChild(el('div', 'alt-answers', 'also correct: ' + card.altSentences.join(' / ')));
    }
    if (sawBlocks) body.appendChild(el('div', 'alt-answers', 'you looked at the blocks for this one'));
    v.appendChild(body);
    block.appendChild(v);

    if (card.note) block.appendChild(el('div', 'note', card.note));
    if (!isRight && card.why) {
      const w = el('div', 'note why');
      w.appendChild(el('strong', null, 'Why: '));
      w.appendChild(document.createTextNode(card.why));
      block.appendChild(w);
    }

    const next = el('div', 'actions');
    const nb = el('button', 'act primary');
    nb.innerHTML = 'Next<span class="kbd">enter</span>';
    nb.addEventListener('click', () => grade(isRight));
    next.appendChild(nb);
    block.appendChild(next);
    wrap.appendChild(block);
    setKeys({ Enter: () => grade(isRight) });
    nb.focus();
  }

  showTyping();
}

/* ---- 4. Sentence: self-graded, free text ---- */
function renderSentence(wrap, card) {
  const isTranslation = card.promptLang === 'en';
  wrap.appendChild(el('p', 'instruction',
    isTranslation ? 'Write it in Danish.' : 'Answer in Danish — your own words are fine.'));
  wrap.appendChild(el('p', `prompt ${isTranslation ? 'en' : 'da'}`, card.prompt));
  if (card.hint) wrap.appendChild(el('p', 'prompt-sub', card.hint));

  const input = plainInput(el('textarea', 'type-in'));
  input.setAttribute('autocapitalize', 'sentences');
  input.placeholder = 'your answer';
  wrap.appendChild(input);

  const actions = el('div', 'actions');
  const submit = el('button', 'act primary');
  submit.innerHTML = 'Show model answer<span class="kbd">⌘/ctrl + enter</span>';
  actions.appendChild(submit);
  wrap.appendChild(actions);

  let done = false;
  const reveal = () => {
    if (done) return;
    done = true;
    input.disabled = true;
    actions.remove();

    const block = el('div', 'answer-block');
    block.appendChild(el('div', 'divider'));
    block.appendChild(el('div', 'label', card.promptLang === 'da' ? 'A model reply' : 'Model answer'));
    block.appendChild(el('p', 'answer', card.modelAnswer));
    if (card.note) block.appendChild(el('div', 'note', card.note));

    const grades = el('div', 'actions');
    const good = el('button', 'act good');
    good.innerHTML = 'Close enough<span class="kbd">1</span>';
    const bad = el('button', 'act bad');
    bad.innerHTML = 'Got it wrong<span class="kbd">2</span>';
    good.addEventListener('click', () => grade(true));
    bad.addEventListener('click', () => grade(false));
    grades.appendChild(good);
    grades.appendChild(bad);
    block.appendChild(grades);

    wrap.appendChild(block);
    setKeys({ '1': () => grade(true), '2': () => grade(false) });
  };

  submit.addEventListener('click', reveal);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); reveal(); }
  });
  setKeys({});
  input.focus();
}

/* ---------------- keyboard ---------------- */

let keymap = {};
function setKeys(map) { keymap = map; }

document.addEventListener('keydown', (e) => {
  if ($('#modal').classList.contains('open')) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (!$('#screen-session').classList.contains('active')) return;

  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  // Inside a text field, only Enter-based shortcuts are handled by the field itself.
  if (typing && e.key !== 'Escape') return;

  // A focused button already gets activated natively by Enter/Space. Handling it
  // here too would fire the action twice and skip the next card.
  if (t && t.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;

  if (e.key === 'Escape') { show('home'); return; }
  const fn = keymap[e.key];
  if (fn) { e.preventDefault(); fn(); }
});

/* ---------------- screens ---------------- */

function show(name) {
  runCardCleanup();
  ['home', 'session', 'results'].forEach((s) => {
    $(`#screen-${s}`).classList.toggle('active', s === name);
  });
  if (name === 'home') { session = null; renderHome(); }
  window.scrollTo(0, 0);
}

/* ---------------- home ---------------- */

function renderHome() {
  $('#total-count').textContent = CARDS.length;

  const missedIds = Object.keys(store.misses).filter((id) => byId.has(id));
  $('#missed-count').textContent = missedIds.length;
  $('#btn-missed').disabled = missedIds.length === 0;

  const grid = $('#category-grid');
  grid.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const b = el('button', 'cat-card');
    b.appendChild(el('span', 'cat-name', cat.name));
    b.appendChild(el('span', 'cat-meta', `${cat.cards.length} card${cat.cards.length === 1 ? '' : 's'}`));
    const dots = el('div', 'cat-types');
    ['flip', 'conjugate', 'reorder', 'sentence'].forEach((t) => {
      const d = el('span', 'dot' + (cat.types.has(t) ? ' on' : ''));
      d.title = TYPE_LABEL[t];
      dots.appendChild(d);
    });
    b.appendChild(dots);
    b.addEventListener('click', () => startSession(cat.cards, cat.name));
    grid.appendChild(b);
  });

  const tGrid = $('#type-grid');
  tGrid.innerHTML = '';
  TYPES.forEach(({ type, cards }) => {
    const b = el('button', 'cat-card');
    b.appendChild(el('span', 'cat-name', TYPE_LABEL[type]));
    b.appendChild(el('span', 'cat-meta', `${cards.length} cards, all categories`));
    b.addEventListener('click', () => startSession(cards, TYPE_LABEL[type] + ' only'));
    tGrid.appendChild(b);
  });

  const h = $('#history-summary');
  if (!store.history.length) {
    h.textContent = 'No sessions yet.';
  } else {
    const last = store.history[0];
    const tot = store.history.reduce((a, s) => a + s.total, 0);
    const right = store.history.reduce((a, s) => a + s.right, 0);
    h.innerHTML = `<b>${store.history.length}</b> session${store.history.length === 1 ? '' : 's'} logged &middot; ` +
      `<b>${right}/${tot}</b> lifetime (${tot ? Math.round((right / tot) * 100) : 0}%) &middot; ` +
      `last: ${last.label} <b>${last.right}/${last.total}</b>`;
  }
}

/* ---------------- export ---------------- */

function buildExport() {
  const lines = [];
  lines.push('# Dansk Drill export');
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('');

  const ids = Object.keys(store.phonetics);
  lines.push(`## Edited pronunciation fields (${ids.length})`);
  if (!ids.length) {
    lines.push('(none yet)');
  } else {
    ids.sort().forEach((id) => {
      const c = byId.get(id);
      const front = c ? c.front : '(card no longer in deck)';
      lines.push(`${id}: ${store.phonetics[id]}`);
      lines.push(`    ^ ${front}  |  was: ${c ? c.phonetic : '?'}`);
    });
  }
  lines.push('');

  const missIds = Object.keys(store.misses).filter((id) => byId.has(id));
  missIds.sort((a, b) => store.misses[b] - store.misses[a]);
  lines.push(`## Cards still marked wrong (${missIds.length}), most-missed first`);
  if (!missIds.length) {
    lines.push('(none)');
  } else {
    missIds.forEach((id) => {
      const c = byId.get(id);
      lines.push(`${store.misses[id]}x  [${c.category}/${c.type}]  ${promptOf(c)}  ->  ${answerOf(c)}`);
    });
  }
  lines.push('');

  lines.push(`## Session history (${store.history.length}), newest first`);
  if (!store.history.length) {
    lines.push('(none)');
  } else {
    store.history.forEach((s) => {
      lines.push(`${s.date.slice(0, 16).replace('T', ' ')}  ${s.right}/${s.total}  ${s.label}`);
    });
  }

  return lines.join('\n');
}

/* ---------------- progress sync (copy on one device, paste on the other) ----------------
   One line of plain text: "DD1:" + base64 of {m: misses, p: pronunciation edits}.
   Card IDs never change, so the code stays valid as the deck grows. Pasting
   merges: every miss from either device is kept (higher count wins), and the
   pasted pronunciation edits are applied. */

const SYNC_PREFIX = 'DD1:';

function toBase64(str) {
  let bin = '';
  new TextEncoder().encode(str).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function fromBase64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

function progressCode() {
  const m = {};
  Object.keys(store.misses).forEach((id) => { if (byId.has(id)) m[id] = store.misses[id]; });
  return SYNC_PREFIX + toBase64(JSON.stringify({ m, p: store.phonetics }));
}

// Returns a short message for the person; throws an Error with a readable message on bad input.
function importProgress(text) {
  const found = String(text).match(/DD1:([A-Za-z0-9+/=\s]+)/);
  if (!found) throw new Error('That doesn\'t look like a progress code. It should start with DD1:');
  let data;
  try {
    data = JSON.parse(fromBase64(found[1].replace(/\s+/g, '')));
  } catch (e) {
    throw new Error('The code looks cut off or changed. Copy it again in one piece.');
  }

  let added = 0;
  let edits = 0;
  Object.entries(asMap(data && data.m)).forEach(([id, n]) => {
    if (!byId.has(id) || !Number.isFinite(n) || n < 1) return;
    const mine = store.misses[id] || 0;
    if (!mine) added++;
    store.misses[id] = Math.max(mine, Math.floor(n));
  });
  Object.entries(asMap(data && data.p)).forEach(([id, v]) => {
    if (!byId.has(id) || typeof v !== 'string' || store.phonetics[id] === v) return;
    store.phonetics[id] = v;
    edits++;
  });
  save();
  const total = Object.keys(store.misses).filter((id) => byId.has(id)).length;
  return `Done. ${added} new missed card${added === 1 ? '' : 's'} added (${total} in total)` +
    (edits ? `, ${edits} pronunciation edit${edits === 1 ? '' : 's'} applied.` : '.');
}

async function copyText(text, fallbackField) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Older browsers or file://: select the text and use the legacy copy command.
    fallbackField.focus();
    fallbackField.select();
    try { return document.execCommand('copy'); } catch (e2) { return false; }
  }
}

function openCopyProgress() {
  const missCount = Object.keys(store.misses).filter((id) => byId.has(id)).length;
  openModal({
    title: 'Copy progress',
    hint: `Your ${missCount} missed card${missCount === 1 ? '' : 's'} and pronunciation edits, as one line. ` +
      'Paste it into "Paste progress" on your other device.',
    text: progressCode(),
    short: true,
    actions: [{
      label: 'Copy',
      primary: true,
      run: async (field, setStatus) => {
        setStatus(await copyText(field.value, field) ? 'Copied.' : 'Couldn\'t copy automatically. Select the text and copy it.');
      },
    }],
  });
}

function openPasteProgress() {
  openModal({
    title: 'Paste progress',
    hint: 'Paste the line from "Copy progress" on your other device. Misses are added to the ones here, nothing is deleted.',
    text: '',
    editable: true,
    short: true,
    placeholder: 'DD1:…',
    actions: [{
      label: 'Import',
      primary: true,
      run: (field, setStatus) => {
        try {
          setStatus(importProgress(field.value));
          renderHome();
        } catch (e) {
          setStatus(e.message, true);
        }
      },
    }],
  });
}

/* ---------------- modal ---------------- */

function openModal({ title, hint, text, editable = false, short = false, placeholder = '', actions = [] }) {
  $('#modal-title').textContent = title;
  $('#modal-hint').textContent = hint;
  const field = $('#modal-text');
  field.value = text;
  field.readOnly = !editable;
  field.placeholder = placeholder;
  field.classList.toggle('short', short);

  const status = $('#modal-status');
  const setStatus = (msg, isError = false) => {
    status.textContent = msg;
    status.classList.toggle('error', isError);
  };
  setStatus('');

  const row = $('#modal-actions');
  row.innerHTML = '';
  actions.forEach((a) => {
    const b = el('button', a.primary ? 'big-btn compact' : 'ghost-btn', a.label);
    b.addEventListener('click', () => a.run(field, setStatus));
    row.appendChild(b);
  });

  $('#modal').classList.add('open');
  field.focus();
  if (!editable) field.setSelectionRange(0, short ? field.value.length : 0);
}
function closeModal() { $('#modal').classList.remove('open'); }

/* ---------------- wiring ---------------- */

$('#btn-freeforall').addEventListener('click', () => startSession(CARDS, 'Free-for-all'));

$('#btn-missed').addEventListener('click', () => {
  const cards = Object.keys(store.misses).filter((id) => byId.has(id)).map((id) => byId.get(id));
  startSession(cards, 'Previous misses');
});

$('#btn-quit').addEventListener('click', () => show('home'));
$('#btn-home').addEventListener('click', () => show('home'));

$('#btn-again').addEventListener('click', () => {
  const last = store.history[0];
  const cards = session ? session.queue : [];
  startSession(cards.length ? cards : CARDS, last ? last.label : 'Free-for-all');
});

$('#btn-retry-missed').addEventListener('click', () => {
  const missed = session.results.filter((r) => !r.correct).map((r) => r.card);
  if (missed.length) startSession(missed, 'Misses from last round');
});

$('#btn-export').addEventListener('click', () => openModal({
  title: 'Export',
  hint: 'Select all and copy this into your markdown files by hand. Nothing is written back automatically.',
  text: buildExport(),
}));
$('#btn-copy-progress').addEventListener('click', openCopyProgress);
$('#btn-paste-progress').addEventListener('click', openPasteProgress);
$('#btn-copy-progress-results').addEventListener('click', openCopyProgress);
$('#modal-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Delete all saved pronunciation edits, session history and miss counts?')) return;
  store = defaultStore();
  save();
  renderHome();
});

renderHome();
