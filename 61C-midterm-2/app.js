/* 61C Midterm 2 practice: UI. Depends on rv.js, datapath.js, harness.js, problems.js and (locally) bank.js. */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hex = (x) => '0x' + (x >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- persistence (per-viewer convenience only) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('61cmt2:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('61cmt2:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const TOPICS = { riscv: 'RISC-V coding', translate: 'Instruction translation', callconv: 'Calling convention', datapath: 'Datapath & control' };
  const DIFF = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
  const BANK = (window.BANK_PROBLEMS || []);
  const ALL = BANK.concat(window.ORIGINAL_PROBLEMS || []);
  const byId = Object.fromEntries(ALL.map(p => [p.id, p]));
  const status = store.get('status', {});
  const setStatus = (id, s) => { status[id] = s; store.set('status', status); };

  // ---------- routing ----------
  function route() {
    const h = location.hash.slice(1) || 'problems';
    $$('.tabs a').forEach(a => a.classList.toggle('on', h.startsWith(a.dataset.tab)));
    const main = $('#main');
    main.innerHTML = '';
    window.scrollTo(0, 0);
    if (h.startsWith('p/') && byId[h.slice(2)]) return renderProblem(main, byId[h.slice(2)]);
    if (h === 'drill-translate') return drillTranslate(main);
    if (h === 'drill-control') return drillControl(main);
    if (h === 'drill-trace') return drillTrace(main);
    if (h === 'sandbox') return sandbox(main);
    if (h === 'drills') return drillsHome(main);
    return problemList(main);
  }

  // ---------- problem list ----------
  const filters = Object.assign({ topic: 'all', diff: 'all', source: 'all', state: 'all' }, store.get('filters', {}));
  function problemList(main) {
    const chip = (group, val, label) => `<button class="chip${filters[group] === val ? ' on' : ''}" data-g="${group}" data-v="${val}">${label}</button>`;
    const counts = (pred) => ALL.filter(pred).length;
    main.innerHTML = `
      ${BANK.length ? '' : `<div class="note">The exam problems from the Ed #533 question bank are not hosted here. The course marks them <em>protected</em>, so this public page only has original problems and drills. Your local copy loads them automatically.</div>`}
      <div class="filters">
        <div class="frow"><span>Topic</span>${chip('topic', 'all', 'All')}${Object.entries(TOPICS).map(([k, v]) => chip('topic', k, `${v} <small>${counts(p => p.topic === k)}</small>`)).join('')}</div>
        <div class="frow"><span>Difficulty</span>${chip('diff', 'all', 'All')}${[1, 2, 3].map(d => chip('diff', String(d), DIFF[d])).join('')}</div>
        <div class="frow"><span>Source</span>${chip('source', 'all', 'All')}${chip('source', 'bank', `Exam bank <small>${BANK.length}</small>`)}${chip('source', 'orig', 'Original')}</div>
        <div class="frow"><span>Status</span>${chip('state', 'all', 'All')}${chip('state', 'todo', 'Not done')}${chip('state', 'done', 'Done')}${chip('state', 'review', 'Review')}</div>
      </div>
      <div class="plist"></div>`;
    $$('.chip', main).forEach(b => b.onclick = () => { filters[b.dataset.g] = b.dataset.v; store.set('filters', filters); problemList(main); });
    const list = ALL.filter(p => (filters.topic === 'all' || p.topic === filters.topic) &&
      (filters.diff === 'all' || String(p.difficulty) === filters.diff) &&
      (filters.source === 'all' || (filters.source === 'bank') === (p.source !== 'Original')) &&
      (filters.state === 'all' || (filters.state === 'todo' ? !status[p.id] : status[p.id] === filters.state)));
    $('.plist', main).innerHTML = list.length ? list.map(p => `
      <a class="pcard" href="#p/${p.id}">
        <div class="pt">${esc(p.title)}</div>
        <div class="pm"><span class="tag t-${p.topic}">${TOPICS[p.topic]}</span><span class="tag d${p.difficulty}">${DIFF[p.difficulty]}</span>
          <span class="src">${esc(p.source)}${p.points ? ' · ' + p.points + ' pts' : ''}</span>
          ${status[p.id] ? `<span class="st st-${status[p.id]}">${status[p.id] === 'done' ? '✓ done' : '↻ review'}</span>` : ''}</div>
      </a>`).join('') : '<p class="muted">No problems match these filters.</p>';
  }

  // ---------- problem view ----------
  function renderProblem(main, p) {
    const idx = ALL.indexOf(p);
    main.innerHTML = `
      <a class="back" href="#problems">← All problems</a>
      <h2>${esc(p.title)}</h2>
      <div class="pm"><span class="tag t-${p.topic}">${TOPICS[p.topic]}</span><span class="tag d${p.difficulty}">${DIFF[p.difficulty]}</span>
        <span class="src">${esc(p.source)}${p.points ? ' · ' + p.points + ' pts' : ''}</span>${p.pdf ? ` · <a href="${p.pdf}" target="_blank" rel="noopener">official PDF</a>` : ''}</div>
      <div class="intro">${p.intro || ''}</div>
      ${(p.images || []).map(src => `<img class="qimg" src="${src}" alt="Problem figure">`).join('')}
      <div class="parts"></div>
      ${p.solutionImages ? `<details class="solimg"><summary>Official solution pages</summary>${p.solutionImages.map(s => `<img class="qimg" src="${s}" alt="Solution">`).join('')}</details>` : ''}
      <div class="pfoot">
        <button class="btn" data-s="done">Mark done</button><button class="btn ghost" data-s="review">Mark for review</button><button class="btn ghost" data-s="">Clear</button>
        <span class="grow"></span>
        ${idx > 0 ? `<a class="btn ghost" href="#p/${ALL[idx - 1].id}">← Prev</a>` : ''}${idx < ALL.length - 1 ? `<a class="btn ghost" href="#p/${ALL[idx + 1].id}">Next →</a>` : ''}
      </div>`;
    $$('.pfoot [data-s]', main).forEach(b => b.onclick = () => { setStatus(p.id, b.dataset.s || undefined); b.textContent = '✓ saved'; });
    const parts = $('.parts', main);
    p.parts.forEach((part, i) => {
      const el = document.createElement('section');
      el.className = 'part';
      parts.appendChild(el);
      const key = p.id + ':' + (part.id || i);
      ({ fill: partFill, code: partCode, mcq: partMcq, short: partShort, signals: partSignals, open: partOpen }[part.type] || partOpen)(el, part, key, p);
    });
  }

  const explainBox = (part) => part.explain ? `<details class="explain"><summary>Explanation</summary><div>${part.explain}</div></details>` : '';
  const label = (part) => part.label ? `<div class="plabel">${esc(part.label)}${part.points ? ` <small>(${part.points} pts)</small>` : ''}</div>` : '';

  function testResults(el, r) {
    if (r.compileErrors.length) {
      el.innerHTML = `<div class="res bad"><b>Assembler error</b>${r.compileErrors.map(e => `<div>${esc(e.msg)}</div>`).join('')}</div>`;
      return false;
    }
    const pass = r.results.filter(x => x.pass).length;
    el.innerHTML = `<div class="res ${pass === r.results.length ? 'good' : 'bad'}"><b>${pass}/${r.results.length} tests passed</b>
      ${r.results.map(x => `<div class="case ${x.pass ? 'ok' : 'no'}">${x.pass ? '✓' : '✗'} <code>${esc(x.name)}</code>${x.fails.map(f => `<div class="why">${esc(f)}</div>`).join('')}</div>`).join('')}</div>`;
    return pass === r.results.length;
  }

  const normAsm = (s) => s.toLowerCase().replace(/#.*/, '').replace(/[,()]/g, ' ').replace(/\bx0\b/g, 'zero').replace(/\bfp\b/g, 's0').replace(/\s+/g, ' ').trim();
  function asmEqual(a, b) {
    if (normAsm(a) === normAsm(b)) return true;
    try { return RV.encode(a) === RV.encode(b); } catch (e) { return false; }
  }

  function partFill(el, part, key) {
    const saved = store.get('fill:' + key, {});
    const lines = part.template.replace(/\n$/, '').split('\n');
    let n = 0;
    const html = lines.map((ln, i) => {
      const body = esc(ln).replace(/\[\[(\w+)\]\]/g, (_, b) => {
        n++;
        const w = Math.max(8, ...(part.blanks[b] || ['']).map(x => x.length)) + 2;
        return `<input class="blank" data-b="${b}" spellcheck="false" autocomplete="off" style="width:${w}ch" value="${esc(saved[b] || '')}" placeholder="${part.hints && part.hints[b] ? esc(part.hints[b]) : ''}">`;
      });
      return `<div class="cl"><span class="ln">${i + 1}</span><span class="cc">${body || ' '}</span></div>`;
    }).join('');
    el.innerHTML = `${label(part)}${part.prompt ? `<p>${part.prompt}</p>` : ''}<div class="codefill">${html}</div>
      <div class="row">${part.test ? '<button class="btn run">Run tests</button>' : ''}<button class="btn ghost cmp">Compare to official</button><button class="btn ghost sol">Show solution</button><button class="btn ghost rst">Clear</button></div>
      <div class="out"></div>${explainBox(part)}`;
    const inputs = $$('.blank', el);
    const values = () => Object.fromEntries(inputs.map(i => [i.dataset.b, i.value]));
    inputs.forEach(i => i.oninput = () => { store.set('fill:' + key, values()); i.classList.remove('ok', 'no'); });
    const build = () => part.template.replace(/\[\[(\w+)\]\]/g, (_, b) => values()[b] || '');
    const compare = () => { let ok = 0; inputs.forEach(i => { const m = (part.blanks[i.dataset.b] || []).some(a => asmEqual(i.value, a)); i.classList.toggle('ok', m); i.classList.toggle('no', !m); ok += m; }); return ok; };
    if (part.test) $('.run', el).onclick = () => {
      const r = Harness.run(build(), part.test);
      testResults($('.out', el), r);
      compare();
    };
    $('.cmp', el).onclick = () => { const ok = compare(); $('.out', el).innerHTML = `<div class="res ${ok === inputs.length ? 'good' : ''}">${ok}/${inputs.length} blanks match an official answer. A mismatch can still be correct${part.test ? ', so run the tests to be sure' : ''}.</div>`; };
    $('.sol', el).onclick = () => { inputs.forEach(i => { i.value = (part.blanks[i.dataset.b] || [''])[0]; }); store.set('fill:' + key, values()); compare(); };
    $('.rst', el).onclick = () => { inputs.forEach(i => { i.value = ''; i.classList.remove('ok', 'no'); }); store.set('fill:' + key, {}); $('.out', el).innerHTML = ''; };
  }

  function editor(initial, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'editor';
    wrap.innerHTML = '<pre class="gutter"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>';
    const ta = $('textarea', wrap), gut = $('.gutter', wrap);
    const sync = () => { const n = ta.value.split('\n').length; gut.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); ta.style.height = 'auto'; ta.style.height = Math.max(160, ta.scrollHeight) + 'px'; };
    ta.value = initial;
    ta.addEventListener('input', () => { sync(); onChange && onChange(ta.value); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
      if (e.key === 'Enter') { const s = ta.selectionStart; const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1; const ind = (ta.value.slice(lineStart, s).match(/^\s*/) || [''])[0]; if (ind) { e.preventDefault(); ta.setRangeText('\n' + ind, s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } }
    });
    setTimeout(sync);
    return { el: wrap, get: () => ta.value, set: (v) => { ta.value = v; sync(); onChange && onChange(v); }, ta };
  }

  function partCode(el, part, key) {
    el.innerHTML = `${label(part)}${part.prompt ? `<p>${part.prompt}</p>` : ''}<div class="edslot"></div>
      <div class="row"><button class="btn run">Run tests</button><button class="btn ghost sb">Open in sandbox</button><button class="btn ghost sol">Show solution</button><button class="btn ghost rst">Reset to starter</button></div>
      <div class="out"></div><div class="solbox"></div>${explainBox(part)}`;
    const ed = editor(store.get('code:' + key, part.starter || ''), v => store.set('code:' + key, v));
    $('.edslot', el).appendChild(ed.el);
    $('.run', el).onclick = () => testResults($('.out', el), Harness.run(ed.get(), part.test));
    $('.sb', el).onclick = () => { store.set('sandbox', ed.get() + '\n' + (part.test && part.test.support || '')); location.hash = 'sandbox'; };
    $('.sol', el).onclick = () => { $('.solbox', el).innerHTML = `<div class="plabel">Reference solution</div><pre class="code">${esc(part.solution || '(none)')}</pre>`; };
    $('.rst', el).onclick = () => { ed.set(part.starter || ''); $('.out', el).innerHTML = ''; };
  }

  function partMcq(el, part, key) {
    const t = part.multi ? 'checkbox' : 'radio';
    el.innerHTML = `${label(part)}${part.prompt ? `<p>${part.prompt}</p>` : ''}<div class="opts">${part.options.map((o, i) =>
      `<label class="opt"><input type="${t}" name="${esc(key)}" value="${i}"><span>${o}</span></label>`).join('')}</div>
      <div class="row"><button class="btn chk">Check</button>${part.multi ? '<span class="muted small">Select all that apply</span>' : ''}</div><div class="out"></div>${explainBox(part)}`;
    $('.chk', el).onclick = () => {
      const chosen = $$('input', el).filter(i => i.checked).map(i => +i.value);
      const ans = [].concat(part.answer);
      const ok = chosen.length === ans.length && ans.every(a => chosen.includes(a));
      $$('.opt', el).forEach((o, i) => { o.classList.toggle('right', ans.includes(i)); o.classList.toggle('wrongpick', chosen.includes(i) && !ans.includes(i)); });
      $('.out', el).innerHTML = `<div class="res ${ok ? 'good' : 'bad'}">${ok ? 'Correct.' : 'Not quite. Correct options are outlined.'}</div>`;
      const ex = $('.explain', el); if (ex) ex.open = true;
    };
  }

  function parseNum(s) {
    s = String(s).trim().replace(/_/g, '').replace(/\s+/g, '');
    if (/^-?0x[0-9a-f]+$/i.test(s)) { const neg = s[0] === '-'; const v = parseInt(s.replace('-', ''), 16); return neg ? -v : v; }
    if (/^-?0b[01]+$/i.test(s)) { const neg = s[0] === '-'; const v = parseInt(s.replace('-', '').slice(2), 2); return neg ? -v : v; }
    if (/^[0-9a-f]{8}$/i.test(s) && /[a-f]/i.test(s)) return parseInt(s, 16);
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    const pow = s.match(/^(-?)2\^(-?\d+)$/); if (pow) return (pow[1] ? -1 : 1) * Math.pow(2, +pow[2]);
    return NaN;
  }
  function checkShort(part, v) {
    if (part.kind === 'hex' || part.kind === 'int') { const n = parseNum(v); return !isNaN(n) && ((n >>> 0) === (part.answer >>> 0) || n === part.answer); }
    if (part.kind === 'asm') return [].concat(part.answer).some(a => asmEqual(v, a));
    const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim();
    return [].concat(part.answer).some(a => norm(a) === norm(v));
  }
  function partShort(el, part, key) {
    el.innerHTML = `${label(part)}<div class="row"><label class="sl">${part.prompt || 'Answer'}</label><input class="sh" spellcheck="false" autocomplete="off" value="${esc(store.get('short:' + key, ''))}"><button class="btn chk">Check</button><button class="btn ghost rev">Reveal</button></div>
      <div class="out"></div>${explainBox(part)}`;
    const inp = $('.sh', el);
    inp.oninput = () => store.set('short:' + key, inp.value);
    const show = () => [].concat(part.answer).map(a => typeof a === 'number' ? (part.kind === 'hex' ? hex(a) : String(a)) : a).join(' or ');
    const check = () => { const ok = checkShort(part, inp.value); $('.out', el).innerHTML = `<div class="res ${ok ? 'good' : 'bad'}">${ok ? 'Correct.' : 'Not correct.'}</div>`; inp.classList.toggle('ok', ok); inp.classList.toggle('no', !ok); };
    $('.chk', el).onclick = check;
    inp.onkeydown = (e) => { if (e.key === 'Enter') check(); };
    $('.rev', el).onclick = () => { $('.out', el).innerHTML = `<div class="res">Answer: <code>${esc(show())}</code></div>`; const ex = $('.explain', el); if (ex) ex.open = true; };
  }

  const SIGLABEL = { Br: 'BrEq/BrLT', Mem: 'Mem (new)' };
  function signalTable(rows, extra) {
    return `<table class="sigt">${rows.map(r => {
      const base = (DP.SIGNALS.find(s => s.sig === r.sig) || { opts: [] }).opts;
      const opts = [...base.filter(o => o !== '*'), ...((extra && extra[r.sig]) || []), '*'];
      return `<tr data-sig="${r.sig}"><th>${r.sig}</th><td>${opts.map(o => `<button class="sopt" data-v="${esc(o)}">${esc(SIGLABEL[o] && !(r.sig === 'WBSel' && o === 'Mem') ? SIGLABEL[o] : o)}</button>`).join('')}</td><td class="sw"></td></tr>`;
    }).join('')}</table>`;
  }
  function wireSignalTable(el) {
    $$('.sigt tr', el).forEach(tr => $$('.sopt', tr).forEach(b => b.onclick = () => { $$('.sopt', tr).forEach(x => x.classList.remove('sel', 'ok', 'no')); b.classList.add('sel'); }));
  }
  function gradeSignalTable(el, truth, why) {
    let ok = 0, total = 0;
    $$('.sigt tr', el).forEach(tr => {
      const s = tr.dataset.sig, sel = $('.sopt.sel', tr), v = sel ? sel.dataset.v : null;
      const g = DP.gradeSignal(truth[s], v);
      total++; if (g === 'ok') ok++;
      $$('.sopt', tr).forEach(b => b.classList.remove('ok', 'no', 'truth'));
      if (sel) sel.classList.add(g === 'ok' ? 'ok' : 'no');
      if (g !== 'ok') { const t = $(`.sopt[data-v="${CSS.escape(truth[s])}"]`, tr); if (t) t.classList.add('truth'); }
      $('.sw', tr).innerHTML = g === 'ok' ? '✓' : `<span class="why">${why ? esc(why(s)) : 'Answer: ' + esc(truth[s])}</span>`;
    });
    return [ok, total];
  }
  function partSignals(el, part) {
    el.innerHTML = `${label(part)}${part.prompt ? `<p>${part.prompt}</p>` : ''}${signalTable(part.rows, part.extraOpts)}
      <div class="row"><button class="btn chk">Check</button><span class="muted small">Choose * only when the value truly doesn't matter.</span></div><div class="out"></div>${explainBox(part)}`;
    wireSignalTable(el);
    $('.chk', el).onclick = () => {
      const truth = Object.fromEntries(part.rows.map(r => [r.sig, r.ans]));
      const [ok, total] = gradeSignalTable(el, truth, part.why ? (s) => part.why[s] || ('Answer: ' + truth[s]) : null);
      $('.out', el).innerHTML = `<div class="res ${ok === total ? 'good' : 'bad'}">${ok}/${total} signals correct.</div>`;
    };
  }

  function partOpen(el, part, key) {
    el.innerHTML = `${label(part)}${part.prompt ? `<p>${part.prompt}</p>` : ''}<textarea class="open" rows="4" placeholder="Your answer">${esc(store.get('open:' + key, ''))}</textarea>
      <div class="row"><button class="btn ghost rev">Show official answer</button></div><div class="out"></div>${explainBox(part)}`;
    $('.open', el).oninput = (e) => store.set('open:' + key, e.target.value);
    $('.rev', el).onclick = () => { $('.out', el).innerHTML = `<div class="res">${part.answerHtml || esc(part.answer || '')}</div>`; };
  }

  // ---------- drills ----------
  function drillsHome(main) {
    main.innerHTML = `<h2>Drills</h2><p class="muted">Unlimited randomly generated practice, checked by the same encoder and simulator.</p>
      <div class="plist">
        <a class="pcard" href="#drill-translate"><div class="pt">Instruction translation</div><div class="pm">Assembly → hex, hex → assembly, field by field</div></a>
        <a class="pcard" href="#drill-control"><div class="pt">Control signals</div><div class="pm">Pick every control signal for a random instruction, then see the active datapath</div></a>
        <a class="pcard" href="#drill-trace"><div class="pt">Datapath trace</div><div class="pm">Given register state, compute the values on the wires: imm, ALU, memory, write-back, next PC</div></a>
      </div>`;
  }

  const REGPOOL = ['zero', 'ra', 'sp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 't3', 's2', 's3'];
  const reg = () => pick(REGPOOL.slice(1));
  function randomInstr(set) {
    const m = pick(set || DP.ALL);
    const rd = reg(), rs1 = reg(), rs2 = reg();
    if (DP.R_OPS.includes(m)) return `${m} ${rd}, ${rs1}, ${rs2}`;
    if (['slli', 'srli', 'srai'].includes(m)) return `${m} ${rd}, ${rs1}, ${rnd(0, 31)}`;
    if (DP.I_OPS[m]) return `${m} ${rd}, ${rs1}, ${pick([rnd(-16, 16), rnd(-2048, 2047), rnd(0, 255)])}`;
    if (DP.LOADS.includes(m) || m === 'jalr') return `${m} ${rd}, ${pick([0, 4, 8, 12, -4, rnd(-64, 64)])}(${rs1})`;
    if (DP.STORES.includes(m)) return `${m} ${rs2}, ${pick([0, 4, 8, -8, rnd(-64, 64)])}(${rs1})`;
    if (DP.BRANCHES.includes(m)) return `${m} ${rs1}, ${rs2}, ${pick([-1, 1]) * 4 * rnd(1, 24)}`;
    if (m === 'jal') return `jal ${pick(['ra', 'zero', 'ra'])}, ${pick([-1, 1]) * 4 * rnd(1, 300)}`;
    return `${m} ${rd}, 0x${rnd(0, 0xfffff).toString(16)}`;
  }

  function fieldsTable(word) {
    const b = (word >>> 0).toString(2).padStart(32, '0');
    const f = RV.fields(word);
    const layouts = {
      R: [['funct7', 0, 7], ['rs2', 7, 12], ['rs1', 12, 17], ['funct3', 17, 20], ['rd', 20, 25], ['opcode', 25, 32]],
      I: [['imm[11:0]', 0, 12], ['rs1', 12, 17], ['funct3', 17, 20], ['rd', 20, 25], ['opcode', 25, 32]],
      S: [['imm[11:5]', 0, 7], ['rs2', 7, 12], ['rs1', 12, 17], ['funct3', 17, 20], ['imm[4:0]', 20, 25], ['opcode', 25, 32]],
      B: [['imm[12|10:5]', 0, 7], ['rs2', 7, 12], ['rs1', 12, 17], ['funct3', 17, 20], ['imm[4:1|11]', 20, 25], ['opcode', 25, 32]],
      U: [['imm[31:12]', 0, 20], ['rd', 20, 25], ['opcode', 25, 32]],
      J: [['imm[20|10:1|11|19:12]', 0, 20], ['rd', 20, 25], ['opcode', 25, 32]],
    }[f.format];
    return `<table class="fields"><tr>${layouts.map(l => `<th>${l[0]}</th>`).join('')}</tr><tr>${layouts.map(l => `<td><code>${b.slice(l[1], l[2])}</code></td>`).join('')}</tr></table>
      <div class="small muted">${f.format}-type · ${esc(RV.decode(word))} · imm = ${f.imm == null ? '—' : f.imm}</div>`;
  }

  function drillTranslate(main) {
    const score = store.get('tr-score', { ok: 0, n: 0 });
    const mode = store.get('tr-mode', 'a2h');
    let cur;
    main.innerHTML = `<a class="back" href="#drills">← Drills</a><h2>Instruction translation</h2>
      <div class="frow"><span>Mode</span><button class="chip" data-m="a2h">Assembly → hex</button><button class="chip" data-m="h2a">Hex → assembly</button>
      <span class="grow"></span><span class="muted small score"></span></div>
      <div class="frow"><span>Types</span><button class="chip tset on" data-t="all">All</button><button class="chip tset" data-t="R">R</button><button class="chip tset" data-t="I">I</button><button class="chip tset" data-t="S">S</button><button class="chip tset" data-t="B">B</button><button class="chip tset" data-t="UJ">U/J</button></div>
      <div class="card q"></div>`;
    let types = 'all';
    $$('[data-m]', main).forEach(b => { b.classList.toggle('on', b.dataset.m === mode); b.onclick = () => { store.set('tr-mode', b.dataset.m); drillTranslate(main); }; });
    $$('.tset', main).forEach(b => b.onclick = () => { types = b.dataset.t; $$('.tset', main).forEach(x => x.classList.toggle('on', x === b)); next(); });
    const showScore = () => { $('.score', main).textContent = `${score.ok}/${score.n} correct`; };
    const setFor = () => types === 'all' ? DP.ALL : DP.ALL.filter(m => types === 'UJ' ? 'UJ'.includes(DP.fmt(m)) : DP.fmt(m) === types);
    function next() {
      const line = randomInstr(setFor());
      const word = RV.encode(line);
      cur = { line, word };
      const q = $('.q', main);
      q.innerHTML = mode === 'a2h'
        ? `<p>Translate to hex:</p><pre class="big">${esc(line)}</pre><div class="row"><input class="sh" placeholder="0x..." spellcheck="false"><button class="btn chk">Check</button><button class="btn ghost skip">Show &amp; next</button></div><div class="out"></div>`
        : `<p>Translate to assembly (offsets in bytes, e.g. <code>beq t0, t1, -8</code>):</p><pre class="big">${hex(word)}</pre><div class="row"><input class="sh" placeholder="addi a0, a1, 4" spellcheck="false"><button class="btn chk">Check</button><button class="btn ghost skip">Show &amp; next</button></div><div class="out"></div>`;
      const inp = $('.sh', q);
      inp.focus();
      const reveal = (ok) => { $('.out', q).innerHTML = `<div class="res ${ok ? 'good' : 'bad'}">${ok ? 'Correct.' : 'Answer: <code>' + esc(mode === 'a2h' ? hex(word) : RV.decode(word)) + '</code>'}${fieldsTable(word)}<button class="btn nxt">Next</button></div>`; $('.nxt', q).onclick = next; $('.nxt', q).focus(); };
      const check = () => {
        let ok;
        if (mode === 'a2h') { const n = parseNum(inp.value); ok = !isNaN(n) && (n >>> 0) === (word >>> 0); }
        else { try { ok = RV.encode(inp.value) === word; } catch (e) { ok = false; } }
        score.n++; if (ok) score.ok++; store.set('tr-score', score); showScore(); reveal(ok);
      };
      $('.chk', q).onclick = check;
      inp.onkeydown = (e) => { if (e.key === 'Enter') check(); };
      $('.skip', q).onclick = () => { score.n++; store.set('tr-score', score); showScore(); reveal(false); };
    }
    showScore(); next();
  }

  function drillControl(main) {
    const score = store.get('cs-score', { ok: 0, n: 0 });
    main.innerHTML = `<a class="back" href="#drills">← Drills</a><h2>Control signals</h2>
      <p class="muted small">Single-cycle datapath from the 61C reference card. PCSel "BrEq/BrLT" means the next PC depends on the branch comparator. Choose * only when the value truly doesn't matter; MemRW and RegWEn are never *, because a stray write corrupts state.</p>
      <div class="frow"><span class="muted small score"></span></div><div class="card q"></div>`;
    const showScore = () => { $('.score', main).textContent = `${score.ok}/${score.n} instructions fully correct`; };
    function next() {
      const line = randomInstr();
      const m = line.split(' ')[0];
      const truth = DP.control(m);
      const q = $('.q', main);
      q.innerHTML = `<pre class="big">${esc(line)}</pre>
        ${signalTable(DP.SIGNALS.map(s => ({ sig: s.sig })))}
        <div class="row"><button class="btn chk">Check</button></div><div class="out"></div><div class="dpwrap">${DP.svg({})}</div>`;
      wireSignalTable(q);
      $('.chk', q).onclick = () => {
        const [ok, total] = gradeSignalTable(q, truth, (s) => DP.WHY[s](m) + ' → ' + truth[s]);
        score.n++; if (ok === total) score.ok++; store.set('cs-score', score); showScore();
        $('.out', q).innerHTML = `<div class="res ${ok === total ? 'good' : 'bad'}">${ok}/${total} correct. Highlighted wires carry values that matter for <code>${m}</code>.</div><button class="btn nxt">Next instruction</button>`;
        $('.dpwrap', q).innerHTML = DP.svg({ active: DP.activeWires(m), signals: truth });
        $('.nxt', q).onclick = next;
      };
    }
    showScore(); next();
  }

  function drillTrace(main) {
    main.innerHTML = `<a class="back" href="#drills">← Drills</a><h2>Datapath trace</h2>
      <p class="muted small">Compute what the single-cycle datapath produces for one instruction. Enter numbers in decimal or 0x hex. Write "none" if there is no write-back.</p><div class="card q"></div>`;
    function next() {
      const set = [...DP.LOADS.filter(x => x !== 'lbu'), 'sw', 'sb', 'beq', 'bne', 'blt', 'bltu', 'jal', 'jalr', 'lui', 'auipc', 'add', 'sub', 'slt', 'sltu', 'addi', 'slli', 'srai', 'xori', 'andi'];
      const line = randomInstr(set);
      const pc = 4 * rnd(0x40, 0x400);
      const regs = {};
      REGPOOL.slice(1).forEach(r => { regs[r] = pick([rnd(-20, 20), rnd(0, 255), rnd(-3000, 3000), (rnd(0, 0xffff) << 16) | rnd(0, 0xffff)]); });
      regs.sp = 0x7ffff000; regs.zero = 0;
      const f = RV.fields(RV.encode(line));
      if (DP.LOADS.includes(f.mnemonic) || DP.STORES.includes(f.mnemonic) || f.mnemonic === 'jalr') {
        const base = 0x10000000 + 4 * rnd(0, 64); regs[RV.ABI[f.rs1]] = (base - f.imm) | 0;
        if (f.mnemonic === 'lw' || f.mnemonic === 'jalr' || DP.STORES.includes(f.mnemonic)) regs[RV.ABI[f.rs1]] = (base - f.imm) | 0;
        else regs[RV.ABI[f.rs1]] = (base + rnd(0, 3) - f.imm) | 0;
        if (f.mnemonic === 'lh' || f.mnemonic === 'lhu') regs[RV.ABI[f.rs1]] &= ~1;
      }
      if (f.mnemonic === 'jalr') regs[RV.ABI[f.rs1]] = (4 * rnd(0x40, 0x400) - f.imm) | 0;
      const mem = {};
      const t0 = DP.trace(line, { pc, regs, mem: {} });
      if (DP.LOADS.includes(f.mnemonic)) mem[t0.alu & ~3] = (rnd(0, 0xffff) << 16) | rnd(0, 0xffff);
      const t = DP.trace(line, { pc, regs, mem });
      const used = new Set([f.rs1, f.rs2].filter(x => x != null && (t.control.ASel === 'Reg' || t.control.PCSel === 'Br' || DP.STORES.includes(f.mnemonic) || DP.R_OPS.includes(f.mnemonic)) ).map(i => RV.ABI[i]));
      if (f.rs1 != null && t.control.ASel === 'Reg') used.add(RV.ABI[f.rs1]);
      const qs = [['imm', 'Immediate (ImmGen output)', t.control.ImmSel === '*' ? null : t.imm], ['alu', 'ALU output', t.alu],
        ['mem', 'DMEM read data', DP.LOADS.includes(f.mnemonic) ? t.mem : null], ['wb', 'Value written to rd', t.wb], ['next', 'Next PC', t.next]];
      const q = $('.q', main);
      q.innerHTML = `<pre class="big">${esc(line)}</pre>
        <div class="state"><span>PC = <code>${hex(pc)}</code></span>${[...used].map(r => `<span>${r} = <code>${regs[r] | 0}</code> (<code>${hex(regs[r])}</code>)</span>`).join('')}
        ${Object.keys(mem).map(a => `<span>Mem[<code>${hex(+a)}</code>] = <code>${hex(mem[a])}</code> (word, little-endian)</span>`).join('')}</div>
        <table class="trace">${qs.map(([k, l, v]) => `<tr data-k="${k}"><th>${l}</th><td><input spellcheck="false" placeholder="${v == null ? 'none' : ''}"></td><td class="tw"></td></tr>`).join('')}</table>
        <div class="row"><button class="btn chk">Check</button><button class="btn ghost nxt">New instruction</button></div><div class="out"></div><div class="dpwrap">${DP.svg({})}</div>`;
      $('.nxt', q).onclick = next;
      $('.chk', q).onclick = () => {
        let ok = 0;
        qs.forEach(([k, , v]) => {
          const tr = $(`tr[data-k="${k}"]`, q); const s = $('input', tr).value.trim().toLowerCase();
          const good = v == null ? (s === '' || s === 'none' || s === '*' || s === '-') : (!isNaN(parseNum(s)) && (parseNum(s) >>> 0) === (v >>> 0));
          ok += good;
          $('.tw', tr).innerHTML = good ? '✓' : `<span class="why">${v == null ? 'none (unused)' : `${v | 0} = ${hex(v)}`}</span>`;
        });
        $('.out', q).innerHTML = `<div class="res ${ok === qs.length ? 'good' : 'bad'}">${ok}/${qs.length} correct.${t.taken != null ? ` Branch ${t.taken ? 'taken' : 'not taken'}.` : ''}${t.memWrite ? ` Store writes ${t.memWrite.size} byte(s) of ${hex(t.memWrite.value)} to ${hex(t.memWrite.addr)}.` : ''}</div>`;
        const show = (x) => x == null ? null : hex(x);
        $('.dpwrap', q).innerHTML = DP.svg({ active: DP.activeWires(f.mnemonic), signals: t.control,
          values: { pc: show(t.pc), pc4: show(t.pc4), rs1: t.rs1 != null ? show(t.rs1) : null, rs2: t.rs2 != null ? show(t.rs2) : null, imm: t.control.ImmSel === '*' ? null : show(t.imm), A: t.A != null ? show(t.A) : null, B: show(t.B), alu: show(t.alu), mem: show(t.mem), wb: t.wb != null ? show(t.wb) : null, next: show(t.next) } });
      };
    }
    next();
  }

  // ---------- sandbox ----------
  function sandbox(main) {
    const DEFAULT = '# Free RISC-V sandbox (Venus-style ecalls: a0=1 print int a1, a0=4 print string a1, a0=11 print char, a0=10 exit)\n.data\nmsg: .asciiz "sum = "\n.text\nmain:\n    li t0, 0\n    li t1, 1\nloop:\n    add t0, t0, t1\n    addi t1, t1, 1\n    li t2, 11\n    blt t1, t2, loop\n    li a0, 4\n    la a1, msg\n    ecall\n    li a0, 1\n    mv a1, t0\n    ecall\n    li a0, 10\n    ecall\n';
    main.innerHTML = `<h2>Sandbox</h2><p class="muted small">Assemble, run or step through any RV32IM program. Execution starts at <code>main</code> if it exists, otherwise at the first instruction.</p>
      <div class="sbgrid"><div><div class="edslot"></div>
        <div class="row"><button class="btn run">Run</button><button class="btn ghost asm">Assemble / reset</button><button class="btn ghost stp">Step</button><button class="btn ghost ex">Load example</button></div>
        <div class="out"></div><pre class="console"></pre></div>
        <div><div class="regs"></div><details class="lst" open><summary>Machine code</summary><div class="listing"></div></details></div></div>`;
    const ed = editor(store.get('sandbox', DEFAULT), v => store.set('sandbox', v));
    $('.edslot', main).appendChild(ed.el);
    let prog = null, m = null, prev = {};
    const out = $('.out', main), con = $('.console', main);
    function assemble() {
      prog = RV.assemble(ed.get());
      if (!prog.ok) { out.innerHTML = `<div class="res bad"><b>Assembler error</b>${prog.errors.map(e => `<div>${esc(e.msg)}</div>`).join('')}</div>`; m = null; return false; }
      m = new RV.Machine(prog); prev = {};
      out.innerHTML = ''; con.textContent = '';
      $('.listing', main).innerHTML = `<table class="lt">${prog.text.map(t => `<tr data-a="${t.addr}"><td>${hex(t.addr)}</td><td><code>${hex(t.word)}</code></td><td><code>${esc(t.basic || '')}</code></td><td class="muted">${esc((t.src || '').trim())}</td></tr>`).join('')}</table>`;
      showRegs(); return true;
    }
    function showRegs() {
      if (!m) return;
      $('.regs', main).innerHTML = `<div class="pcline">PC = <code>${hex(m.pc)}</code></div><table class="rt">${RV.ABI.map((n, i) => { const v = m.reg(i); const ch = prev[i] != null && prev[i] !== v; return `<tr class="${ch ? 'chg' : ''}"><td>x${i}</td><td>${n}</td><td><code>${hex(v)}</code></td><td>${v | 0}</td></tr>`; }).join('')}</table>`;
      $$('.lt tr', main).forEach(tr => tr.classList.toggle('cur', +tr.dataset.a === m.pc));
    }
    const snap = () => { prev = {}; RV.ABI.forEach((_, i) => { prev[i] = m.reg(i); }); };
    $('.asm', main).onclick = assemble;
    $('.ex', main).onclick = () => { ed.set(DEFAULT); assemble(); };
    $('.run', main).onclick = () => {
      if (!assemble()) return;
      snap();
      const r = m.run({ maxSteps: 2e6 });
      con.textContent = m.output || '';
      out.innerHTML = `<div class="res ${r.status === 'error' || r.status === 'limit' ? 'bad' : 'good'}">${r.status === 'error' ? esc(r.error) : r.status === 'limit' ? 'Stopped after 2,000,000 steps (infinite loop?)' : `Finished (${r.status}${r.exitCode != null ? ', exit code ' + r.exitCode : ''}) after ${r.steps} instructions.`}</div>`;
      showRegs();
    };
    $('.stp', main).onclick = () => {
      if (!m && !assemble()) return;
      snap();
      m.step();
      con.textContent = m.output || '';
      out.innerHTML = m.status ? `<div class="res ${m.status === 'error' ? 'bad' : ''}">${esc(m.error || ('Program ' + m.status + (m.exitCode != null ? ', exit code ' + m.exitCode : '')))}</div>` : '';
      showRegs();
    };
    assemble();
  }

  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', () => {
    $('#bankinfo').textContent = BANK.length ? `${BANK.length} exam-bank problems loaded (local copy)` : '';
    route();
  });
})();
