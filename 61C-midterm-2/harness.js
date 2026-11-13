/* Test harness for RISC-V coding problems. Data-only test specs → pass/fail with readable feedback. */
(function () {
  'use strict';
  const RV = (typeof window !== 'undefined' && window.RV) || require('./rv.js');
  const hex = (x) => '0x' + (x >>> 0).toString(16);

  // Argument kinds: number | {words:[]} | {halves:[]} | {bytes:[]} | {str:''} | {list:[]} (nodes {int val; node* next}) | {null:true}
  function place(m, a) {
    if (typeof a === 'number') return a | 0;
    if (a == null || a.null) return 0;
    if (a.words) { const p = m.malloc(Math.max(4, a.words.length * 4)); a.words.forEach((v, i) => m.store(p + 4 * i, 4, v)); return p; }
    if (a.halves) { const p = m.malloc(Math.max(4, a.halves.length * 2 + 2)); a.halves.forEach((v, i) => m.store(p + 2 * i, 2, v)); return p; }
    if (a.bytes) { const p = m.malloc(Math.max(4, a.bytes.length + 1)); a.bytes.forEach((v, i) => m.store(p + i, 1, v)); return p; }
    if (a.str != null) { const p = m.malloc(a.str.length + 4); m.writeString(p, a.str); return p; }
    if (a.list) {
      let next = 0;
      for (let i = a.list.length - 1; i >= 0; i--) { const p = m.malloc(8); m.store(p, 4, a.list[i]); m.store(p + 4, 4, next); next = p; }
      return next;
    }
    if (a.strs) { const ptrs = a.strs.map(s => place(m, { str: s })); return place(m, { words: ptrs }); }
    throw new Error('bad arg spec');
  }

  function describeArg(a) {
    if (typeof a === 'number') return String(a);
    if (a == null || a.null) return 'NULL';
    if (a.words) return '[' + a.words.join(', ') + ']';
    if (a.halves) return 'uint16[' + a.halves.map(hex).join(', ') + ']';
    if (a.bytes) return 'bytes[' + a.bytes.join(', ') + ']';
    if (a.str != null) return JSON.stringify(a.str);
    if (a.list) return 'list ' + (a.list.length ? a.list.join(' → ') : '(empty)');
    if (a.strs) return '[' + a.strs.map(s => JSON.stringify(s)).join(', ') + ']';
    return '?';
  }

  function run(code, test) {
    const src = code + '\n' + (test.support || '') + '\n';
    const asm = RV.assemble(src, { externs: Object.keys(Object.assign({}, RV.stdExterns || {}, test.externs || {})) });
    if (!asm.ok) return { compileErrors: asm.errors.map(e => ({ line: e.line, msg: e.msg })), results: [] };
    const results = [];
    for (const c of test.cases) {
      const ptrs = [];
      const res = RV.callFunction(src, test.fn, {
        args: [], externs: test.externs, maxSteps: test.maxSteps || 200000, seed: c.seed,
        setup: (m) => { (c.args || []).forEach((a, i) => { const v = place(m, a); ptrs.push(v); m.setReg('a' + i, v); }); },
      });
      const fails = [];
      if (res.status !== 'returned') fails.push(res.error || ('did not return (' + res.status + ')'));
      else {
        const e = c.expect || {};
        const m = res.machine;
        if (e.a0 != null) {
          const want = e.a0 === 'arg0' ? ptrs[0] : e.a0;
          const got = m.reg('a0');
          if ((got | 0) !== (want | 0)) fails.push(`a0 = ${got | 0} (${hex(got)}), expected ${want | 0} (${hex(want)})`);
        }
        for (const k of ['words', 'halves', 'bytes']) {
          if (!e[k]) continue;
          const size = { words: 4, halves: 2, bytes: 1 }[k];
          const base = ptrs[e[k].arg || 0];
          const got = e[k].values.map((_, i) => m.load(base + i * size, size, false));
          const want = e[k].values.map(v => size === 4 ? v >>> 0 : v & (size === 2 ? 0xffff : 0xff));
          if (got.some((g, i) => (g >>> 0) !== (want[i] >>> 0)))
            fails.push(`memory at arg ${e[k].arg || 0}: got [${got.map(hex).join(', ')}], expected [${want.map(hex).join(', ')}]`);
        }
        if (e.str) { const got = m.readString(ptrs[e.str.arg || 0]); if (got !== e.str.value) fails.push(`string = ${JSON.stringify(got)}, expected ${JSON.stringify(e.str.value)}`); }
        if (e.output != null && res.machine.output !== e.output) fails.push(`printed ${JSON.stringify(res.machine.output)}, expected ${JSON.stringify(e.output)}`);
        for (const v of res.violations || []) fails.push('calling convention: ' + v);
      }
      results.push({ name: c.name || `${test.fn}(${(c.args || []).map(describeArg).join(', ')})`, pass: fails.length === 0, fails,
        steps: res.machine ? res.machine.steps : 0, errorLine: res.errorLine });
    }
    return { compileErrors: [], results };
  }

  const api = { run, place, describeArg };
  if (typeof window !== 'undefined') window.Harness = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
