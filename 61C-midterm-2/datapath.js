/* Single-cycle RV32I datapath (CS 61C reference-card style): control table, SVG diagram, and value tracing. */
(function () {
  'use strict';
  const RV = (typeof window !== 'undefined' && window.RV) || (typeof require !== 'undefined' ? require('./rv.js') : null);

  // ---- Control signals ------------------------------------------------------------------------
  // Values use the 61C exam vocabulary. '*' = don't care. PCSel 'Br' = depends on BrEq/BrLT.
  const SIGNALS = [
    { sig: 'PCSel', opts: ['PC+4', 'ALU', 'Br', '*'], label: { Br: 'Depends on BrEq/BrLT' } },
    { sig: 'ImmSel', opts: ['I', 'S', 'B', 'U', 'J', '*'] },
    { sig: 'BrUn', opts: ['0', '1', '*'] },
    { sig: 'ASel', opts: ['Reg', 'PC', '*'] },
    { sig: 'BSel', opts: ['Reg', 'Imm', '*'] },
    { sig: 'ALUSel', opts: ['add', 'sub', 'and', 'or', 'xor', 'sll', 'srl', 'sra', 'slt', 'sltu', 'bsel', '*'] },
    { sig: 'MemRW', opts: ['Read', 'Write', '*'] },
    { sig: 'RegWEn', opts: ['0', '1', '*'] },
    { sig: 'WBSel', opts: ['Mem', 'ALU', 'PC+4', '*'] },
  ];

  const R_OPS = ['add', 'sub', 'and', 'or', 'xor', 'sll', 'srl', 'sra', 'slt', 'sltu'];
  const I_OPS = { addi: 'add', andi: 'and', ori: 'or', xori: 'xor', slli: 'sll', srli: 'srl', srai: 'sra', slti: 'slt', sltiu: 'sltu' };
  const LOADS = ['lb', 'lh', 'lw', 'lbu', 'lhu'];
  const STORES = ['sb', 'sh', 'sw'];
  const BRANCHES = ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'];

  function control(m) {
    const c = (PCSel, ImmSel, BrUn, ASel, BSel, ALUSel, MemRW, RegWEn, WBSel) =>
      ({ PCSel, ImmSel, BrUn, ASel, BSel, ALUSel, MemRW, RegWEn, WBSel });
    if (R_OPS.includes(m)) return c('PC+4', '*', '*', 'Reg', 'Reg', m, 'Read', '1', 'ALU');
    if (I_OPS[m]) return c('PC+4', 'I', '*', 'Reg', 'Imm', I_OPS[m], 'Read', '1', 'ALU');
    if (LOADS.includes(m)) return c('PC+4', 'I', '*', 'Reg', 'Imm', 'add', 'Read', '1', 'Mem');
    if (STORES.includes(m)) return c('PC+4', 'S', '*', 'Reg', 'Imm', 'add', 'Write', '0', '*');
    if (BRANCHES.includes(m)) return c('Br', 'B', (m === 'bltu' || m === 'bgeu') ? '1' : (m === 'beq' || m === 'bne') ? '*' : '0',
      'PC', 'Imm', 'add', 'Read', '0', '*');
    if (m === 'jal') return c('ALU', 'J', '*', 'PC', 'Imm', 'add', 'Read', '1', 'PC+4');
    if (m === 'jalr') return c('ALU', 'I', '*', 'Reg', 'Imm', 'add', 'Read', '1', 'PC+4');
    if (m === 'lui') return c('PC+4', 'U', '*', '*', 'Imm', 'bsel', 'Read', '1', 'ALU');
    if (m === 'auipc') return c('PC+4', 'U', '*', 'PC', 'Imm', 'add', 'Read', '1', 'ALU');
    return null;
  }

  const WHY = {
    PCSel: m => BRANCHES.includes(m) ? 'Branches pick PC+4 or PC+imm based on the comparator output (BrEq/BrLT).'
      : (m === 'jal' || m === 'jalr') ? 'Jumps always take the ALU result (PC+imm for jal, rs1+imm for jalr) as the next PC.'
      : 'Not a branch or jump, so the next PC is PC+4.',
    ImmSel: m => R_OPS.includes(m) ? 'R-type has no immediate, so ImmGen output is unused.'
      : 'Matches the instruction format (' + fmt(m) + '-type).',
    BrUn: m => BRANCHES.includes(m) ? (m === 'beq' || m === 'bne' ? 'Equality is the same signed or unsigned.' : m.endsWith('u') ? 'Unsigned comparison.' : 'Signed comparison.')
      : 'Only branches read the comparator.',
    ASel: m => m === 'lui' ? 'lui just passes the immediate through (ALUSel = bsel), so A is ignored.'
      : (BRANCHES.includes(m) || m === 'jal' || m === 'auipc') ? 'The ALU computes PC + imm.' : 'The ALU uses rs1.',
    BSel: m => R_OPS.includes(m) ? 'R-type operates on rs2.' : 'Second ALU operand is the immediate.',
    ALUSel: m => m === 'lui' ? 'lui writes imm (upper 20 bits) unchanged: select B.' : (R_OPS.includes(m) || I_OPS[m]) ? 'The instruction\'s own operation.' : 'Address/target computation is an add.',
    MemRW: m => STORES.includes(m) ? 'Stores write memory.' : 'Never Write unless storing; a don\'t-care here could corrupt memory.',
    RegWEn: m => (STORES.includes(m) || BRANCHES.includes(m)) ? 'Stores and branches have no rd.' : 'Writes rd. Never * : a stray write would clobber a register.',
    WBSel: m => (STORES.includes(m) || BRANCHES.includes(m)) ? 'RegWEn = 0, so the write-back value is unused.'
      : LOADS.includes(m) ? 'Loaded value comes from DMEM.' : (m === 'jal' || m === 'jalr') ? 'Jumps link: rd = PC+4.' : 'Result comes from the ALU.',
  };

  function fmt(m) {
    if (R_OPS.includes(m)) return 'R';
    if (I_OPS[m] || LOADS.includes(m) || m === 'jalr') return 'I';
    if (STORES.includes(m)) return 'S';
    if (BRANCHES.includes(m)) return 'B';
    if (m === 'jal') return 'J';
    return 'U';
  }

  // Grade one answer row. Answer '*' is accepted only where the truth is '*'; a concrete answer where truth is '*' is also accepted.
  function gradeSignal(truth, ans) {
    if (ans == null || ans === '') return 'blank';
    if (truth === '*') return 'ok';            // any value works when it doesn't matter
    return ans === truth ? 'ok' : 'wrong';
  }

  // ---- Wire activity ---------------------------------------------------------------------------
  function activeWires(m) {
    const w = new Set(['pc_imem', 'pcsel_out', 'inst', 'pc_add4']);
    const c = control(m);
    if (!c) return w;
    if (c.PCSel === 'PC+4') w.add('pc4_pcsel');
    if (c.PCSel === 'ALU' || c.PCSel === 'Br') w.add('alu_pcsel');
    if (c.PCSel === 'Br') { w.add('pc4_pcsel'); w.add('rs1_cmp'); w.add('rs2_cmp'); }
    if (c.ImmSel !== '*') w.add('imm');
    if (c.ASel === 'Reg') w.add('rs1_a');
    if (c.ASel === 'PC') w.add('pc_a');
    if (c.ASel !== '*') w.add('asel_out');
    if (c.BSel === 'Reg') w.add('rs2_b');
    w.add('bsel_out');
    w.add('alu_out');
    if (LOADS.includes(m) || STORES.includes(m)) w.add('alu_mem');
    if (STORES.includes(m)) w.add('rs2_mem');
    if (c.RegWEn === '1') {
      w.add('wb');
      if (c.WBSel === 'ALU') w.add('alu_wb');
      if (c.WBSel === 'Mem') w.add('mem_wb');
      if (c.WBSel === 'PC+4') w.add('pc4_wb');
    }
    return w;
  }

  // ---- SVG -------------------------------------------------------------------------------------
  const WIRES = {
    pcsel_out: 'M40,190 H62',
    pc_imem: 'M102,190 H140',
    pc_add4: 'M118,190 V78 H140',
    pc_a: 'M118,190 V392 H404 V178 H428',
    pc4_pcsel: 'M180,78 H192 V26 H8 V172 H22',
    pc4_wb: 'M192,26 H700 V236 H716',
    inst: 'M212,190 H236 M236,150 V318 M236,150 H262 M236,180 H262 M236,212 H262 M236,318 H262',
    rs1_a: 'M352,160 H394 V160 H428',
    rs1_cmp: 'M394,160 V72 H410',
    rs2_b: 'M352,200 H382 V240 H428',
    rs2_cmp: 'M382,200 V96 H410',
    rs2_mem: 'M382,240 V352 H574 V250 H592',
    imm: 'M352,318 H412 V262 H428',
    asel_out: 'M446,172 H484',
    bsel_out: 'M446,250 H484',
    alu_out: 'M538,210 H566',
    alu_mem: 'M566,210 H592',
    alu_wb: 'M566,210 V296 H690 V206 H716',
    alu_pcsel: 'M566,296 V408 H4 V208 H22',
    mem_wb: 'M672,206 H682 V176 H716',
    wb: 'M736,206 H752 V12 H246 V244 H262',
  };

  function svg(opts) {
    opts = opts || {};
    const active = opts.active || new Set();
    const vals = opts.values || {};
    const sig = opts.signals || {};
    const wire = (id) => `<path class="dp-w${active.has(id) ? ' on' : ''}" data-w="${id}" d="${WIRES[id]}"/>`;
    const box = (x, y, w, h, t, sub, top) => `<rect class="dp-b" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>` +
      `<text class="dp-t" x="${x + w / 2 + (top ? 8 : 0)}" y="${top ? y + 16 : y + h / 2 + (sub ? -2 : 4)}">${t}</text>` + (sub ? `<text class="dp-s" x="${x + w / 2 + (top ? 8 : 0)}" y="${top ? y + 28 : y + h / 2 + 12}">${sub}</text>` : '');
    const mux = (x, y, h, name, ins) => `<path class="dp-b" d="M${x},${y} L${x + 18},${y + 8} L${x + 18},${y + h - 8} L${x},${y + h} Z"/>` +
      ins.map((t, i) => `<text class="dp-p" x="${x + 3}" y="${y + 14 + i * ((h - 16) / Math.max(1, ins.length - 1))}">${t}</text>`).join('') +
      `<text class="dp-sig${sig[name] != null ? ' set' : ''}" x="${x + 9}" y="${y + h + 14}">${name}${sig[name] != null ? '=' + sig[name] : ''}</text>`;
    const v = (x, y, key, anchor) => vals[key] != null ? `<text class="dp-v" x="${x}" y="${y}" text-anchor="${anchor || 'start'}">${vals[key]}</text>` : '';
    return `<svg class="dp" viewBox="0 0 780 420" role="img" aria-label="Single-cycle RISC-V datapath">
      ${Object.keys(WIRES).map(wire).join('')}
      ${mux(22, 160, 60, 'PCSel', ['+4', 'ALU'])}
      ${box(62, 170, 40, 40, 'PC')}
      ${box(140, 64, 40, 28, '+4')}
      ${box(140, 160, 72, 60, 'IMEM')}
      ${box(262, 134, 90, 124, 'RegFile', 'RegWEn' + (sig.RegWEn != null ? '=' + sig.RegWEn : ''), true)}
      <text class="dp-p" x="266" y="154">rs1</text><text class="dp-p" x="266" y="184">rs2</text><text class="dp-p" x="266" y="216">rd</text><text class="dp-p" x="266" y="248">DataD</text>
      ${box(262, 300, 90, 36, 'ImmGen', 'ImmSel' + (sig.ImmSel != null ? '=' + sig.ImmSel : ''))}
      ${box(410, 56, 80, 54, 'Branch', 'Comp · BrUn' + (sig.BrUn != null ? '=' + sig.BrUn : ''))}
      ${mux(428, 150, 44, 'ASel', ['R', 'PC'])}
      ${mux(428, 226, 44, 'BSel', ['R', 'Im'])}
      <path class="dp-b" d="M484,150 L538,180 L538,240 L484,270 L484,224 L496,210 L484,196 Z"/>
      <text class="dp-t" x="516" y="214">ALU</text>
      <text class="dp-sig${sig.ALUSel != null ? ' set' : ''}" x="511" y="290">ALUSel${sig.ALUSel != null ? '=' + sig.ALUSel : ''}</text>
      ${box(592, 168, 80, 100, 'DMEM', 'MemRW' + (sig.MemRW != null ? '=' + sig.MemRW : ''), true)}
      <text class="dp-p" x="596" y="214">Addr</text><text class="dp-p" x="596" y="254">DataW</text>
      ${mux(716, 160, 92, 'WBSel', ['Mem', 'ALU', '+4'])}
      ${v(104, 186, 'pc')}${v(184, 74, 'pc4')}${v(214, 186, 'inst')}${v(356, 156, 'rs1')}${v(356, 196, 'rs2')}
      ${v(356, 314, 'imm')}${v(448, 168, 'A')}${v(448, 246, 'B')}${v(542, 206, 'alu')}${v(674, 202, 'mem')}${v(740, 202, 'wb')}
      ${v(494, 52, 'br')}${v(24, 236, 'next', 'start')}
    </svg>`;
  }

  // ---- Value trace -----------------------------------------------------------------------------
  const hex = (x) => '0x' + ((x >>> 0).toString(16).padStart(8, '0'));
  function trace(line, state) {
    // state: {pc, regs: {name: value}, mem: {addr: word}}
    const word = RV.encode(line);
    const f = RV.fields(word);
    const m = f.mnemonic;
    const c = control(m);
    const R = (i) => (i === 0 ? 0 : (state.regs[RV.ABI[i]] != null ? state.regs[RV.ABI[i]] : state.regs['x' + i] || 0)) | 0;
    const pc = state.pc >>> 0;
    const rs1 = f.rs1 != null ? R(f.rs1) : null;
    const rs2 = f.rs2 != null ? R(f.rs2) : null;
    let imm = f.imm;
    if (m === 'lui' || m === 'auipc') imm = (f.imm << 12) | 0;
    const A = c.ASel === 'PC' ? pc : c.ASel === 'Reg' ? rs1 : null;
    const B = c.BSel === 'Reg' ? rs2 : imm;
    const alu = (() => {
      const a = A | 0, b = B | 0;
      switch (c.ALUSel) {
        case 'add': return (a + b) | 0; case 'sub': return (a - b) | 0; case 'and': return a & b; case 'or': return a | b;
        case 'xor': return a ^ b; case 'sll': return a << (b & 31); case 'srl': return (a >>> (b & 31)) | 0;
        case 'sra': return a >> (b & 31); case 'slt': return a < b ? 1 : 0; case 'sltu': return (a >>> 0) < (b >>> 0) ? 1 : 0;
        case 'bsel': return b;
      }
    })();
    if (m === 'jalr') { /* target LSB cleared */ }
    let mem = null;
    const memWord = (addr) => (state.mem && state.mem[addr & ~3] != null ? state.mem[addr & ~3] : 0) | 0;
    if (LOADS.includes(m)) {
      const w = memWord(alu), sh = (alu & 3) * 8;
      if (m === 'lw') mem = w;
      if (m === 'lh') mem = ((w >>> sh) << 16) >> 16;
      if (m === 'lhu') mem = (w >>> sh) & 0xffff;
      if (m === 'lb') mem = ((w >>> sh) << 24) >> 24;
      if (m === 'lbu') mem = (w >>> sh) & 0xff;
    }
    let taken = null;
    if (BRANCHES.includes(m)) {
      const a = rs1 | 0, b = rs2 | 0;
      taken = { beq: a === b, bne: a !== b, blt: a < b, bge: a >= b, bltu: (a >>> 0) < (b >>> 0), bgeu: (a >>> 0) >= (b >>> 0) }[m];
    }
    const pc4 = (pc + 4) | 0;
    const next = c.PCSel === 'ALU' ? (m === 'jalr' ? alu & ~1 : alu) : c.PCSel === 'Br' ? (taken ? alu : pc4) : pc4;
    const wb = c.RegWEn === '1' ? (c.WBSel === 'ALU' ? alu : c.WBSel === 'Mem' ? mem : pc4) : null;
    return { mnemonic: m, fields: f, word, control: c, pc, pc4, rs1, rs2, imm, A, B, alu, mem, taken, wb, next,
      memWrite: STORES.includes(m) ? { addr: alu, value: rs2, size: { sb: 1, sh: 2, sw: 4 }[m] } : null };
  }

  const ALL = [...R_OPS, ...Object.keys(I_OPS), ...LOADS, ...STORES, ...BRANCHES, 'jal', 'jalr', 'lui', 'auipc'];
  const api = { SIGNALS, control, gradeSignal, activeWires, svg, trace, fmt, WHY, ALL, R_OPS, I_OPS, LOADS, STORES, BRANCHES, hex };
  if (typeof window !== 'undefined') window.DP = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
