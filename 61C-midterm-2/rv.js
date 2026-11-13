/*
 * rv.js — a small, dependency-free RV32IM assembler + simulator for CS 61C practice.
 * Venus-compatible syntax. Works as a browser <script> (window.RV) and as a Node module.
 *
 *   RV.assemble(src, {externs})  -> program object
 *   RV.encode(line) / RV.decode(word) / RV.fields(word)
 *   new RV.Machine(prog, opts)   -> step(), run(), reg(), load(), store(), ...
 *   RV.callFunction(prog, label, {args, setup, externs, maxSteps})
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- registers
  const ABI = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1',
    'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
    's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];
  const REGS = { fp: 8 };
  ABI.forEach((n, i) => { REGS[n] = i; REGS['x' + i] = i; });
  const S_REGS = [8, 9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
  const CLOBBER_REGS = [5, 6, 7, 28, 29, 30, 31, 12, 13, 14, 15, 16, 17];

  const TEXT_BASE = 0x00000000, DATA_BASE = 0x10000000, HEAP_BASE = 0x10008000;
  const SP_INIT = 0x7FFFFFF0, GP_INIT = 0x10008000, SENTINEL = 0xFFFFFFF0;

  const hex = (v, w = 8) => '0x' + ((v >>> 0).toString(16).padStart(w, '0'));

  class AsmError extends Error {}
  class SimError extends Error {}

  // ---------------------------------------------------------- instruction tables
  const R = { add: [0, 0], sub: [0, 0x20], sll: [1, 0], slt: [2, 0], sltu: [3, 0], xor: [4, 0],
    srl: [5, 0], sra: [5, 0x20], or: [6, 0], and: [7, 0],
    mul: [0, 1], mulh: [1, 1], mulhsu: [2, 1], mulhu: [3, 1], div: [4, 1], divu: [5, 1], rem: [6, 1], remu: [7, 1] };
  const IA = { addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7 };
  const SH = { slli: [1, 0], srli: [5, 0], srai: [5, 0x20] };
  const LD = { lb: 0, lh: 1, lw: 2, lbu: 4, lhu: 5 };
  const ST = { sb: 0, sh: 1, sw: 2 };
  const BR = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 };
  const invert = (t, f) => { const o = {}; for (const k in t) o[f(t[k])] = k; return o; };
  const R_BY = invert(R, v => v[0] + ',' + v[1]);
  const IA_BY = invert(IA, v => v), LD_BY = invert(LD, v => v), ST_BY = invert(ST, v => v), BR_BY = invert(BR, v => v);
  const SH_BY = invert(SH, v => v[0] + ',' + v[1]);

  // ------------------------------------------------------------------ parsing
  const ESC = { n: '\n', t: '\t', r: '\r', 0: '\0', '\\': '\\', "'": "'", '"': '"' };
  const unescape = s => s.replace(/\\(.)/g, (_, c) => (c in ESC ? ESC[c] : c));

  function parseNum(tok) {
    if (typeof tok === 'number') return tok;
    tok = String(tok).trim();
    const ch = /^'(\\.|[^\\'])'$/.exec(tok);
    if (ch) return unescape(ch[1]).charCodeAt(0);
    let t = tok, neg = false;
    if (t[0] === '-' || t[0] === '+') { neg = t[0] === '-'; t = t.slice(1); }
    let v;
    if (/^0x[0-9a-f]+$/i.test(t)) v = parseInt(t.slice(2), 16);
    else if (/^0b[01]+$/i.test(t)) v = parseInt(t.slice(2), 2);
    else if (/^[0-9]+$/.test(t)) v = parseInt(t, 10);
    else return null;
    return neg ? -v : v;
  }

  function reg(tok) {
    const r = REGS[String(tok).trim().toLowerCase()];
    if (r === undefined) throw new AsmError(`invalid register '${tok}'`);
    return r;
  }

  function imm(tok, lo, hi, what) {
    const v = parseNum(tok);
    if (v === null) throw new AsmError(`expected a number for ${what} but got '${tok}'`);
    if (v < lo || v > hi) throw new AsmError(`immediate ${tok} out of range for ${what} (must be ${lo}..${hi})`);
    return v;
  }

  // "8(sp)" / "(sp)" / "-4(x2)"
  function memOperand(tok, mn) {
    const m = /^(.*)\(\s*([^()]+?)\s*\)$/.exec(String(tok).trim());
    if (!m) throw new AsmError(`${mn} expects an operand of the form offset(register), got '${tok}'`);
    return { off: m[1].trim() === '' ? 0 : imm(m[1], -2048, 2047, mn + ' offset'), rs: reg(m[2]) };
  }

  // branch/jal target: a number is a byte offset, a name is a label
  function target(tok, pc, addrOf) {
    const v = parseNum(tok);
    if (v !== null) return v;
    return (addrOf(String(tok).trim()) - pc) | 0;
  }

  function splitOperands(s) { return s.match(/'(?:\\.|[^'\\])'|[^\s,]+/g) || []; }

  function stripComment(line) {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '#') return line.slice(0, i);
    }
    return line;
  }

  // ----------------------------------------------------------------- encoding
  const iType = (im, rs1, f3, rd, op) => (((im & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
  const sType = (im, rs2, rs1, f3) =>
    ((((im >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((im & 0x1f) << 7) | 0x23) >>> 0;
  const bType = (im, rs2, rs1, f3) =>
    ((((im >> 12) & 1) << 31) | (((im >> 5) & 0x3f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) |
      (((im >> 1) & 0xf) << 8) | (((im >> 11) & 1) << 7) | 0x63) >>> 0;
  const jType = (im, rd) =>
    ((((im >> 20) & 1) << 31) | (((im >> 1) & 0x3ff) << 21) | (((im >> 11) & 1) << 20) |
      (((im >> 12) & 0xff) << 12) | (rd << 7) | 0x6f) >>> 0;

  function encodeReal(mn, ops, pc, addrOf) {
    const need = n => { if (ops.length !== n) throw new AsmError(`${mn} expects ${n} operand${n === 1 ? '' : 's'}, got ${ops.length}`); };
    if (mn in R) {
      need(3); const [f3, f7] = R[mn];
      return ((f7 << 25) | (reg(ops[2]) << 20) | (reg(ops[1]) << 15) | (f3 << 12) | (reg(ops[0]) << 7) | 0x33) >>> 0;
    }
    if (mn in IA) { need(3); return iType(imm(ops[2], -2048, 2047, mn), reg(ops[1]), IA[mn], reg(ops[0]), 0x13); }
    if (mn in SH) {
      need(3); const [f3, f7] = SH[mn];
      return ((f7 << 25) | (imm(ops[2], 0, 31, mn + ' shift amount') << 20) | (reg(ops[1]) << 15) | (f3 << 12) | (reg(ops[0]) << 7) | 0x13) >>> 0;
    }
    if (mn in LD) { need(2); const m = memOperand(ops[1], mn); return iType(m.off, m.rs, LD[mn], reg(ops[0]), 0x03); }
    if (mn in ST) { need(2); const m = memOperand(ops[1], mn); return sType(m.off, reg(ops[0]), m.rs, ST[mn]); }
    if (mn in BR) {
      need(3); const rs1 = reg(ops[0]), rs2 = reg(ops[1]), off = target(ops[2], pc, addrOf);
      if (off & 1) throw new AsmError(`branch offset ${off} must be even`);
      if (off < -4096 || off > 4094) throw new AsmError(`branch target out of range (offset ${off}, must be -4096..4094)`);
      return bType(off, rs2, rs1, BR[mn]);
    }
    switch (mn) {
      case 'jal': {
        need(2); const rd = reg(ops[0]), off = target(ops[1], pc, addrOf);
        if (off & 1) throw new AsmError(`jal offset ${off} must be even`);
        if (off < -1048576 || off > 1048574) throw new AsmError(`jal target out of range (offset ${off})`);
        return jType(off, rd);
      }
      case 'jalr': {
        if (ops.length === 2) { const m = memOperand(ops[1], mn); return iType(m.off, m.rs, 0, reg(ops[0]), 0x67); }
        need(3); return iType(imm(ops[2], -2048, 2047, mn), reg(ops[1]), 0, reg(ops[0]), 0x67);
      }
      case 'lui': case 'auipc': {
        need(2); const v = imm(ops[1], -0x80000, 0xFFFFF, mn);
        return (((v & 0xFFFFF) << 12) | (reg(ops[0]) << 7) | (mn === 'lui' ? 0x37 : 0x17)) >>> 0;
      }
      case 'ecall': need(0); return 0x00000073;
      case 'ebreak': need(0); return 0x00100073;
    }
    throw new AsmError(`unknown instruction '${mn}'`);
  }

  // hi/lo split for auipc-relative sequences (la, call, tail)
  function hiLo(delta) {
    delta |= 0;
    const lo = ((delta & 0xfff) << 20) >> 20;
    return { hi: ((delta - lo) >>> 12) & 0xFFFFF, lo };
  }

  // Expand a (possibly pseudo) instruction into real ones: [[mn, ops], ...]
  function expand(mn, ops, pc, addrOf) {
    const need = n => { if (ops.length !== n) throw new AsmError(`${mn} expects ${n} operand${n === 1 ? '' : 's'}, got ${ops.length}`); };
    const o = ops;
    switch (mn) {
      case 'nop': need(0); return [['addi', ['x0', 'x0', 0]]];
      case 'li': {
        need(2); reg(o[0]);
        let v = parseNum(o[1]);
        if (v === null) throw new AsmError(`li expects a numeric immediate, got '${o[1]}' (use la for labels)`);
        if (v < -0x80000000 || v > 0xFFFFFFFF) throw new AsmError(`immediate ${o[1]} out of range for li (must fit in 32 bits)`);
        v |= 0;
        if (v >= -2048 && v <= 2047) return [['addi', [o[0], 'x0', v]]];
        const { hi, lo } = hiLo(v);
        return lo === 0 ? [['lui', [o[0], hi]]] : [['lui', [o[0], hi]], ['addi', [o[0], o[0], lo]]];
      }
      case 'la': {
        need(2); reg(o[0]);
        const abs = parseNum(o[1]);
        const { hi, lo } = hiLo((abs !== null ? abs : addrOf(o[1])) - pc);
        return [['auipc', [o[0], hi]], ['addi', [o[0], o[0], lo]]];
      }
      case 'call': case 'tail': {
        need(1); const r = mn === 'call' ? 'ra' : 't1';
        const { hi, lo } = hiLo(target(o[0], pc, addrOf));
        return [['auipc', [r, hi]], ['jalr', [mn === 'call' ? 'ra' : 'x0', r, lo]]];
      }
      case 'mv': need(2); return [['addi', [o[0], o[1], 0]]];
      case 'not': need(2); return [['xori', [o[0], o[1], -1]]];
      case 'neg': need(2); return [['sub', [o[0], 'x0', o[1]]]];
      case 'seqz': need(2); return [['sltiu', [o[0], o[1], 1]]];
      case 'snez': need(2); return [['sltu', [o[0], 'x0', o[1]]]];
      case 'sltz': need(2); return [['slt', [o[0], o[1], 'x0']]];
      case 'sgtz': need(2); return [['slt', [o[0], 'x0', o[1]]]];
      case 'beqz': need(2); return [['beq', [o[0], 'x0', o[1]]]];
      case 'bnez': need(2); return [['bne', [o[0], 'x0', o[1]]]];
      case 'blez': need(2); return [['bge', ['x0', o[0], o[1]]]];
      case 'bgez': need(2); return [['bge', [o[0], 'x0', o[1]]]];
      case 'bltz': need(2); return [['blt', [o[0], 'x0', o[1]]]];
      case 'bgtz': need(2); return [['blt', ['x0', o[0], o[1]]]];
      case 'bgt': need(3); return [['blt', [o[1], o[0], o[2]]]];
      case 'ble': need(3); return [['bge', [o[1], o[0], o[2]]]];
      case 'bgtu': need(3); return [['bltu', [o[1], o[0], o[2]]]];
      case 'bleu': need(3); return [['bgeu', [o[1], o[0], o[2]]]];
      case 'j': need(1); return [['jal', ['x0', o[0]]]];
      case 'jal': return o.length === 1 ? [['jal', ['ra', o[0]]]] : [['jal', o]];
      case 'jr': need(1); return [['jalr', ['x0', o[0], 0]]];
      case 'jalr':
        if (o.length === 1) return [['jalr', ['ra', o[0], 0]]];
        if (o.length === 2 && !/\(/.test(o[1])) return [['jalr', [o[0], o[1], 0]]];
        return [['jalr', o]];
      case 'ret': need(0); return [['jalr', ['x0', 'ra', 0]]];
    }
    return [[mn, o]];
  }

  // ---------------------------------------------------------------- assembler
  function assemble(src, opts = {}) {
    const errors = [], labels = {}, items = [], data = [], fixups = [];
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    let seg = 'text', pc = TEXT_BASE, dp = DATA_BASE;
    const err = (line, msg) => errors.push({ line, msg: `line ${line}: ${msg}` });
    const putByte = b => { data.push({ addr: dp, byte: b & 0xff }); dp++; };
    const putVal = (v, n) => { for (let i = 0; i < n; i++) putByte(v >> (8 * i)); };

    // Pass 1: labels, data, instruction sizes.
    lines.forEach((raw, idx) => {
      const ln = idx + 1;
      let s = stripComment(raw).trim(), m;
      while ((m = /^([A-Za-z_.$][\w.$]*)\s*:/.exec(s))) {
        const name = m[1];
        if (name in labels) err(ln, `label '${name}' defined more than once`);
        else labels[name] = seg === 'text' ? pc : dp;
        s = s.slice(m[0].length).trim();
      }
      if (!s) return;
      try {
        if (s[0] === '.') {
          const dm = /^(\.\w+)\s*(.*)$/.exec(s), dir = dm[1].toLowerCase(), rest = dm[2];
          switch (dir) {
            case '.text': seg = 'text'; return;
            case '.data': seg = 'data'; return;
            case '.globl': case '.global': case '.section': case '.type': case '.size': return;
          }
          if (seg !== 'data') throw new AsmError(`directive ${dir} is only allowed in the .data segment`);
          switch (dir) {
            case '.word': case '.half': case '.byte': {
              const n = dir === '.word' ? 4 : dir === '.half' ? 2 : 1, toks = splitOperands(rest);
              if (!toks.length) throw new AsmError(`${dir} needs at least one value`);
              for (const t of toks) {
                const v = parseNum(t);
                if (v === null) {
                  if (n !== 4 || !/^[A-Za-z_.$][\w.$]*$/.test(t)) throw new AsmError(`bad value '${t}' for ${dir}`);
                  fixups.push({ addr: dp, label: t, line: ln, at: data.length }); putVal(0, 4);
                } else {
                  const lim = 2 ** (8 * n);
                  if (v < -lim / 2 || v >= lim) throw new AsmError(`value ${t} does not fit in ${dir}`);
                  putVal(v, n);
                }
              }
              return;
            }
            case '.asciiz': case '.string': case '.ascii': {
              const re = /"((?:\\.|[^"\\])*)"/g; let sm, any = false;
              while ((sm = re.exec(rest))) {
                any = true;
                for (const c of unescape(sm[1])) putByte(c.charCodeAt(0));
                if (dir !== '.ascii') putByte(0);
              }
              if (!any) throw new AsmError(`${dir} expects a "quoted string"`);
              return;
            }
            case '.space': { const n = imm(rest, 0, 1 << 24, '.space'); for (let i = 0; i < n; i++) putByte(0); return; }
            case '.align': { const a = 1 << imm(rest, 0, 12, '.align'); while (dp % a) putByte(0); return; }
          }
          throw new AsmError(`unknown directive '${dir}'`);
        }
        if (seg !== 'text') throw new AsmError(`instruction in .data segment`);
        const sp = s.search(/\s/), mn = (sp < 0 ? s : s.slice(0, sp)).toLowerCase();
        const ops = sp < 0 ? [] : splitOperands(s.slice(sp));
        const n = expand(mn, ops, pc, () => pc).length;  // size only; labels not known yet
        items.push({ mn, ops, line: ln, src: raw.trim(), pc });
        pc += 4 * n;
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        err(ln, e.message);
        if (seg === 'text' && s[0] !== '.') { items.push({ mn: null, line: ln, pc }); pc += 4; }
      }
    });

    const textEnd = pc;
    // Extern functions (callFunction harness): undefined labels named in opts.externs get stub addresses.
    const externs = {};
    let ex = textEnd + 0x100;
    const addrOf = name => {
      if (name in labels) return labels[name];
      if (opts.externs && opts.externs.indexOf(name) >= 0) {
        if (!(name in externs)) { externs[name] = ex; ex += 4; }
        return externs[name];
      }
      throw new AsmError(`undefined label '${name}'`);
    };

    for (const f of fixups) {
      try { const v = addrOf(f.label); for (let i = 0; i < 4; i++) data[f.at + i].byte = (v >>> (8 * i)) & 0xff; }
      catch (e) { if (!(e instanceof AsmError)) throw e; err(f.line, e.message); }
    }

    // Pass 2: encode.
    const text = [];
    for (const it of items) {
      if (!it.mn) continue;
      try {
        let a = it.pc;
        for (const [mn, ops] of expand(it.mn, it.ops, it.pc, addrOf)) {
          const word = encodeReal(mn, ops, a, addrOf);
          text.push({ addr: a, word, line: it.line, src: it.src, basic: decode(word) });
          a += 4;
        }
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        err(it.line, e.message);
      }
    }
    errors.sort((a, b) => a.line - b.line);
    return {
      ok: errors.length === 0, errors, text, labels, dataBytes: data, externs,
      entry: 'main' in labels && labels.main < textEnd ? labels.main : TEXT_BASE, textEnd, dataEnd: dp,
    };
  }

  // ------------------------------------------------------------ decode/fields
  function fields(word) {
    const w = word >>> 0, s = w | 0;
    const f = { format: null, opcode: w & 0x7f, rd: (w >> 7) & 31, funct3: (w >> 12) & 7,
      rs1: (w >> 15) & 31, rs2: (w >> 20) & 31, funct7: w >>> 25, imm: null, mnemonic: null };
    const only = keep => { for (const k of ['rd', 'funct3', 'rs1', 'rs2', 'funct7']) if (keep.indexOf(k) < 0) f[k] = null; };
    switch (f.opcode) {
      case 0x33: f.format = 'R'; f.mnemonic = R_BY[f.funct3 + ',' + f.funct7] || null; break;
      case 0x13:
        f.format = 'I';
        if (f.funct3 === 1 || f.funct3 === 5) {     // shifts: imm = shamt, funct7 kept
          f.imm = f.rs2; f.mnemonic = SH_BY[f.funct3 + ',' + f.funct7] || null; only(['rd', 'funct3', 'rs1', 'funct7']);
        } else { f.imm = s >> 20; f.mnemonic = IA_BY[f.funct3]; only(['rd', 'funct3', 'rs1']); }
        break;
      case 0x03: f.format = 'I'; f.imm = s >> 20; f.mnemonic = LD_BY[f.funct3] || null; only(['rd', 'funct3', 'rs1']); break;
      case 0x67: f.format = 'I'; f.imm = s >> 20; f.mnemonic = f.funct3 === 0 ? 'jalr' : null; only(['rd', 'funct3', 'rs1']); break;
      case 0x73:
        f.format = 'I'; f.imm = s >> 20;
        f.mnemonic = (w === 0x73) ? 'ecall' : (w === 0x00100073) ? 'ebreak' : null; only(['rd', 'funct3', 'rs1']); break;
      case 0x23: f.format = 'S'; f.imm = ((s >> 25) << 5) | ((w >> 7) & 31); f.mnemonic = ST_BY[f.funct3] || null; only(['funct3', 'rs1', 'rs2']); break;
      case 0x63:
        f.format = 'B'; f.mnemonic = BR_BY[f.funct3] || null; only(['funct3', 'rs1', 'rs2']);
        f.imm = ((s >> 31) << 12) | (((w >> 7) & 1) << 11) | (((w >> 25) & 0x3f) << 5) | (((w >> 8) & 0xf) << 1);
        break;
      case 0x37: case 0x17: f.format = 'U'; f.imm = w >>> 12; f.mnemonic = f.opcode === 0x37 ? 'lui' : 'auipc'; only(['rd']); break;
      case 0x6f:
        f.format = 'J'; f.mnemonic = 'jal'; only(['rd']);
        f.imm = ((s >> 31) << 20) | (((w >> 12) & 0xff) << 12) | (((w >> 20) & 1) << 11) | (((w >> 21) & 0x3ff) << 1);
        break;
    }
    return f;
  }

  // Canonical assembly text for a machine word, or null if it isn't a valid RV32IM instruction.
  function decode(word) {
    const f = fields(word), mn = f.mnemonic, N = i => ABI[i];
    if (!mn) return null;
    switch (f.format) {
      case 'R': return `${mn} ${N(f.rd)}, ${N(f.rs1)}, ${N(f.rs2)}`;
      case 'I':
        if (mn === 'ecall' || mn === 'ebreak') return mn;
        if (f.opcode === 0x03) return `${mn} ${N(f.rd)}, ${f.imm}(${N(f.rs1)})`;
        return `${mn} ${N(f.rd)}, ${N(f.rs1)}, ${f.imm}`;
      case 'S': return `${mn} ${N(f.rs2)}, ${f.imm}(${N(f.rs1)})`;
      case 'B': return `${mn} ${N(f.rs1)}, ${N(f.rs2)}, ${f.imm}`;
      case 'U': return `${mn} ${N(f.rd)}, 0x${f.imm.toString(16)}`;
      case 'J': return `${mn} ${N(f.rd)}, ${f.imm}`;
    }
    return null;
  }

  // Encode one instruction line (numeric offsets only). Throws Error on bad input.
  function encode(line) {
    const s = stripComment(String(line)).trim(), sp = s.search(/\s/);
    const mn = (sp < 0 ? s : s.slice(0, sp)).toLowerCase(), ops = sp < 0 ? [] : splitOperands(s.slice(sp));
    const noLabels = name => { throw new AsmError(`labels are not allowed here ('${name}'); use a numeric byte offset`); };
    const real = expand(mn, ops, 0, noLabels);
    if (real.length !== 1) throw new AsmError(`'${mn}' expands to ${real.length} instructions; encode() takes a single instruction`);
    return encodeReal(real[0][0], real[0][1], 0, noLabels);
  }

  // ---------------------------------------------------------------- simulator
  const PAGE = 4096;

  class Machine {
    constructor(prog, opts = {}) {
      if (typeof prog === 'string') prog = assemble(prog);
      if (!prog.ok) throw new Error('cannot run a program with assembly errors:\n' + prog.errors.map(e => e.msg).join('\n'));
      this.prog = prog;
      this.x = new Int32Array(32);
      this.mem = new Map();
      this.code = [];
      for (const t of prog.text) {
        const f = fields(t.word);
        this.code[t.addr >>> 2] = { mn: f.mnemonic, rd: f.rd, rs1: f.rs1, rs2: f.rs2, imm: f.imm, line: t.line, src: t.src };
        this.store(t.addr, 4, t.word);
      }
      for (const d of prog.dataBytes) this.store(d.addr, 1, d.byte);
      this.textEnd = prog.textEnd;
      this.pc = prog.entry >>> 0;
      this.x[2] = SP_INIT; this.x[3] = GP_INIT;
      this.brk = Math.max(HEAP_BASE, (prog.dataEnd + 7) & ~7);
      this.output = '';
      this.steps = 0;
      this.status = null; this.exitCode = null; this.error = null; this.errorLine = null;
      this.lastLine = null;
      this.stopAt = opts.stopAt;
      this.externFns = opts.externs || {};
      this.externAt = new Map(Object.entries(prog.externs || {}).map(([n, a]) => [a >>> 0, n]));
      this._seed = (opts.seed >>> 0) || 0x61C61C;
    }

    // --- registers
    reg(r) { return this.x[typeof r === 'number' ? r : reg(r)]; }
    setReg(r, v) {
      const i = typeof r === 'number' ? r : reg(r);
      if (i === 11) this._a1Set = true;
      if (i !== 0) this.x[i] = v | 0;
    }

    // --- memory (sparse, little-endian). These helpers do no safety checks.
    _page(a, make) {
      const p = a >>> 12;
      let pg = this.mem.get(p);
      if (!pg && make) { pg = new Uint8Array(PAGE); this.mem.set(p, pg); }
      return pg;
    }
    load(addr, size = 4, signed = false) {
      let v = 0;
      for (let i = 0; i < size; i++) {
        const a = (addr + i) >>> 0, pg = this._page(a, false);
        v |= (pg ? pg[a & 0xfff] : 0) << (8 * i);
      }
      if (size === 4) return signed ? v | 0 : v >>> 0;
      const sh = 32 - 8 * size;
      return signed ? (v << sh) >> sh : v;
    }
    store(addr, size, val) {
      for (let i = 0; i < size; i++) { const a = (addr + i) >>> 0; this._page(a, true)[a & 0xfff] = (val >>> (8 * i)) & 0xff; }
    }
    writeWords(addr, arr) { arr.forEach((v, i) => this.store(addr + 4 * i, 4, v)); return addr; }
    readWords(addr, n) { const out = []; for (let i = 0; i < n; i++) out.push(this.load(addr + 4 * i, 4, true)); return out; }
    writeString(addr, s) { let i = 0; for (; i < s.length; i++) this.store(addr + i, 1, s.charCodeAt(i)); this.store(addr + i, 1, 0); return addr; }
    readString(addr, max = 100000) {
      let s = '';
      for (let i = 0; i < max; i++) { const c = this.load(addr + i, 1); if (!c) break; s += String.fromCharCode(c); }
      return s;
    }
    malloc(n) { const p = this.brk; this.brk = (this.brk + Math.max(0, n | 0) + 7) & ~7; return p; }
    _garbage() { this._seed = (Math.imul(this._seed, 1103515245) + 12345) >>> 0; return (this._seed ^ 0xBAD0BAD0) | 0; }

    // --- checked memory access for student instructions
    _check(addr, size, write) {
      addr >>>= 0;
      if (addr < 0x1000) throw new SimError(`null pointer access (${write ? 'store to' : 'load from'} address ${hex(addr)})`);
      if (write && addr < DATA_BASE) throw new SimError(`store into the text segment (address ${hex(addr)})`);
      return addr;
    }

    _fail(msg, line) {
      this.status = 'error';
      this.errorLine = line == null ? null : line;
      this.error = (line != null ? `line ${line}: ` : '') + msg;
      return false;
    }

    // Execute one instruction. Returns false once the machine has stopped.
    step() {
      if (this.status) return false;
      const pc = this.pc >>> 0;
      if (this.stopAt !== undefined && pc === (this.stopAt >>> 0)) { this.status = 'returned'; return false; }
      if (this.externAt.has(pc)) return this._callExtern(this.externAt.get(pc));
      if (pc === this.textEnd && this.stopAt === undefined) { this.status = 'exit'; this.exitCode = 0; return false; }
      const ins = (pc & 3) === 0 && pc < this.textEnd ? this.code[pc >>> 2] : undefined;
      if (!ins) {
        const why = pc === this.textEnd ? ' (ran off the end of the code; missing ret?)' : '';
        return this._fail(`jumped to invalid address ${hex(pc)}${why}`, this.lastLine);
      }
      this.lastLine = ins.line;
      try { this._exec(ins, pc); } catch (e) {
        if (e instanceof SimError || e instanceof AsmError) return this._fail(e.message, ins.line);
        throw e;
      }
      this.x[0] = 0;
      this.steps++;
      return !this.status;
    }

    _callExtern(name) {
      const fn = this.externFns[name];
      if (typeof fn !== 'function') return this._fail(`call to undefined function '${name}'`, this.lastLine);
      this._a1Set = false;
      let r;
      try { r = fn(this); } catch (e) { return this._fail(`${name}: ${e.message}`, this.lastLine); }
      if (typeof r === 'number') this.x[10] = r | 0;
      for (const i of CLOBBER_REGS) this.x[i] = this._garbage();
      if (!this._a1Set) this.x[11] = this._garbage();
      this.pc = this.x[1] >>> 0;
      this.steps++;
      return !this.status;
    }

    _exec(ins, pc) {
      const x = this.x, a = x[ins.rs1], b = x[ins.rs2], im = ins.imm;
      let next = (pc + 4) >>> 0, v;
      const big = n => BigInt(n), hi32 = p => Number(BigInt.asIntN(32, p >> 32n));
      switch (ins.mn) {
        case 'add': v = (a + b) | 0; break;
        case 'sub': v = (a - b) | 0; break;
        case 'sll': v = a << (b & 31); break;
        case 'srl': v = a >>> (b & 31); break;
        case 'sra': v = a >> (b & 31); break;
        case 'slt': v = a < b ? 1 : 0; break;
        case 'sltu': v = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        case 'xor': v = a ^ b; break;
        case 'or': v = a | b; break;
        case 'and': v = a & b; break;
        case 'mul': v = Math.imul(a, b); break;
        case 'mulh': v = hi32(big(a) * big(b)); break;
        case 'mulhsu': v = hi32(big(a) * big(b >>> 0)); break;
        case 'mulhu': v = hi32(big(a >>> 0) * big(b >>> 0)); break;
        case 'div': v = b === 0 ? -1 : (a === -0x80000000 && b === -1) ? a : Math.trunc(a / b) | 0; break;
        case 'divu': v = b === 0 ? -1 : Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
        case 'rem': v = b === 0 ? a : (a === -0x80000000 && b === -1) ? 0 : (a % b) | 0; break;
        case 'remu': v = b === 0 ? a : ((a >>> 0) % (b >>> 0)) | 0; break;
        case 'addi': v = (a + im) | 0; break;
        case 'slti': v = a < im ? 1 : 0; break;
        case 'sltiu': v = (a >>> 0) < (im >>> 0) ? 1 : 0; break;
        case 'xori': v = a ^ im; break;
        case 'ori': v = a | im; break;
        case 'andi': v = a & im; break;
        case 'slli': v = a << im; break;
        case 'srli': v = a >>> im; break;
        case 'srai': v = a >> im; break;
        case 'lb': v = this.load(this._check(a + im, 1), 1, true); break;
        case 'lh': v = this.load(this._check(a + im, 2), 2, true); break;
        case 'lw': v = this.load(this._check(a + im, 4), 4, true); break;
        case 'lbu': v = this.load(this._check(a + im, 1), 1); break;
        case 'lhu': v = this.load(this._check(a + im, 2), 2); break;
        case 'sb': this.store(this._check(a + im, 1, true), 1, b); break;
        case 'sh': this.store(this._check(a + im, 2, true), 2, b); break;
        case 'sw': this.store(this._check(a + im, 4, true), 4, b); break;
        case 'beq': if (a === b) next = (pc + im) >>> 0; break;
        case 'bne': if (a !== b) next = (pc + im) >>> 0; break;
        case 'blt': if (a < b) next = (pc + im) >>> 0; break;
        case 'bge': if (a >= b) next = (pc + im) >>> 0; break;
        case 'bltu': if ((a >>> 0) < (b >>> 0)) next = (pc + im) >>> 0; break;
        case 'bgeu': if ((a >>> 0) >= (b >>> 0)) next = (pc + im) >>> 0; break;
        case 'jal': v = next; next = (pc + im) >>> 0; break;
        case 'jalr': v = next; next = ((a + im) & ~1) >>> 0; break;
        case 'lui': v = im << 12; break;
        case 'auipc': v = (pc + (im << 12)) | 0; break;
        case 'ecall': this._ecall(); break;
        case 'ebreak': this.status = 'break'; break;
        default: throw new SimError(`illegal instruction`);
      }
      if (v !== undefined && ins.rd) x[ins.rd] = v;
      this.pc = next;
    }

    _ecall() {
      const a0 = this.x[10], a1 = this.x[11];
      switch (a0) {
        case 1: this.output += String(a1); break;
        case 4: this.output += this.readString(this._check(a1, 1)); break;
        case 9: this.x[10] = this.malloc(a1); break;
        case 10: this.status = 'exit'; this.exitCode = 0; break;
        case 11: this.output += String.fromCharCode(a1 & 0xff); break;
        case 17: this.status = 'exit'; this.exitCode = a1; break;
        default: throw new SimError(`unknown ecall ${a0} (a0 selects the call: 1 print_int, 4 print_string, 9 sbrk, 10 exit, 11 print_char, 17 exit2)`);
      }
    }

    run({ maxSteps = 1e6 } = {}) {
      const limit = this.steps + maxSteps;
      while (!this.status && this.steps < limit) this.step();
      if (!this.status) { this.status = 'limit'; this.error = `step limit of ${maxSteps} reached (infinite loop?)`; this.errorLine = this.lastLine; }
      return { status: this.status, exitCode: this.exitCode, error: this.error, errorLine: this.errorLine, steps: this.steps, output: this.output };
    }
  }

  // ------------------------------------------------- function-call test harness
  const stdExterns = {
    malloc: m => m.malloc(m.reg('a0')),
    calloc: m => { const n = m.reg('a0') * m.reg('a1'), p = m.malloc(n); for (let i = 0; i < n; i++) m.store(p + i, 1, 0); return p; },
    free: () => {},
    strlen: m => m.readString(m.reg('a0')).length,
  };

  function callFunction(prog, label, opts = {}) {
    const externs = Object.assign({}, stdExterns, opts.externs || {});
    if (typeof prog === 'string') prog = assemble(prog, { externs: Object.keys(externs) });
    if (!prog.ok) {
      return { status: 'error', error: prog.errors.map(e => e.msg).join('\n'), errors: prog.errors, a0: 0, a1: 0, machine: null, violations: [] };
    }
    if (!(label in prog.labels)) {
      return { status: 'error', error: `no label '${label}' in your code`, errors: [], a0: 0, a1: 0, machine: null, violations: [] };
    }
    const m = new Machine(prog, { externs, stopAt: SENTINEL, seed: opts.seed });
    for (let i = 1; i < 32; i++) if (i !== 2 && i !== 3 && i !== 4) m.x[i] = m._garbage();
    m.x[1] = SENTINEL | 0;
    (opts.args || []).forEach((arg, i) => {
      if (typeof arg === 'string') arg = m.writeString(m.malloc(arg.length + 1), arg);
      else if (Array.isArray(arg)) arg = m.writeWords(m.malloc(4 * arg.length), arg);
      m.x[10 + i] = arg | 0;
    });
    if (opts.setup) opts.setup(m);
    const savedS = S_REGS.map(i => m.x[i]), savedSp = m.x[2];
    m.pc = prog.labels[label] >>> 0;
    const r = m.run({ maxSteps: opts.maxSteps || 1e6 });
    const violations = [];
    if (r.status === 'returned') {
      S_REGS.forEach((ri, k) => {
        if (m.x[ri] !== savedS[k]) violations.push(`${ABI[ri]} was not restored (expected ${hex(savedS[k])}, got ${hex(m.x[ri])})`);
      });
      if (m.x[2] !== savedSp) violations.push(`sp was not restored (expected ${hex(savedSp)}, got ${hex(m.x[2])})`);
    }
    return Object.assign(r, { a0: m.reg('a0'), a1: m.reg('a1'), machine: m, violations });
  }

  const RV = {
    assemble, encode, decode, fields, Machine, callFunction, stdExterns,
    ABI, REGS, parseNum,
    TEXT_BASE, DATA_BASE, HEAP_BASE, SP_INIT, GP_INIT, SENTINEL,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RV;
  else if (root) root.RV = RV;   // browser: window.RV
})(typeof globalThis !== 'undefined' ? globalThis : this);
