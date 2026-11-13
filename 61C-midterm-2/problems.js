/* Original practice problems (written for this site, modeled on the MT2 rubric: RISC-V coding 10, translation 4, datapath & control 6).
   Exam problems from the Ed #533 bank are NOT here: they load from a local-only bank.js. */
(function () {
  'use strict';
  const P = [];

  // ===================================== RISC-V coding =====================================
  P.push({
    id: 'o-popcount', title: 'Count the set bits', topic: 'riscv', difficulty: 1, source: 'Original', points: 4,
    intro: `<p>Write <code>popcount</code>: return the number of 1 bits in <code>a0</code> (treat it as unsigned 32-bit). Use only <code>t</code> registers and <code>a0</code>.</p>`,
    parts: [{
      type: 'code', id: 'code',
      starter: 'popcount:\n    # a0 = x. Return the number of 1 bits in x.\n\n    jr ra\n',
      solution: 'popcount:\n    li t0, 0          # count\nloop:\n    beqz a0, done\n    andi t1, a0, 1\n    add t0, t0, t1\n    srli a0, a0, 1    # logical shift: must terminate for negative x\n    j loop\ndone:\n    mv a0, t0\n    jr ra\n',
      explain: 'Use <code>srli</code>, not <code>srai</code>: an arithmetic shift copies the sign bit, so a negative input never reaches 0 and the loop runs forever.',
      test: { fn: 'popcount', cases: [
        { args: [0], expect: { a0: 0 } }, { args: [1], expect: { a0: 1 } }, { args: [0xF0F0], expect: { a0: 8 } },
        { args: [-1], expect: { a0: 32 } }, { args: [0x80000000 | 0], expect: { a0: 1 } }, { args: [0x12345678], expect: { a0: 13 } }] },
    }],
  });

  P.push({
    id: 'o-listsum', title: 'Sum a linked list', topic: 'riscv', difficulty: 2, source: 'Original', points: 6,
    intro: `<pre>typedef struct node { int val; struct node *next; } node;   // sizeof(node) == 8
int sum_list(node *head);   // returns 0 for an empty list</pre><p>Fill in the blanks.</p>`,
    parts: [{
      type: 'fill', id: 'fill',
      template: 'sum_list:\n    li t0, 0\nloop:\n    [[b1]]\n    [[b2]]\n    add t0, t0, t1\n    [[b3]]\n    j loop\ndone:\n    [[b4]]\n    jr ra\n',
      blanks: { b1: ['beqz a0, done', 'beq a0, x0, done', 'beq a0 zero done'], b2: ['lw t1, 0(a0)'], b3: ['lw a0, 4(a0)'], b4: ['mv a0, t0', 'addi a0, t0, 0', 'add a0, t0, x0'] },
      explain: '<code>val</code> is at offset 0 and <code>next</code> at offset 4. Loading <code>next</code> back into <code>a0</code> advances the cursor; the loop ends when the cursor is NULL.',
      test: { fn: 'sum_list', cases: [
        { args: [{ list: [] }], expect: { a0: 0 } }, { args: [{ list: [5] }], expect: { a0: 5 } },
        { args: [{ list: [1, 2, 3, 4] }], expect: { a0: 10 } }, { args: [{ list: [-7, 7, 100] }], expect: { a0: 100 } }] },
    }],
  });

  P.push({
    id: 'o-reverse', title: 'Reverse an int array in place', topic: 'riscv', difficulty: 2, source: 'Original', points: 6,
    intro: `<pre>void reverse(int *arr, int n);   // swap arr[i] and arr[n-1-i]</pre><p>Write it from scratch. Only <code>t</code> and <code>a</code> registers.</p>`,
    parts: [{
      type: 'code', id: 'code',
      starter: 'reverse:\n    # a0 = arr, a1 = n\n\n    jr ra\n',
      solution: 'reverse:\n    slli t0, a1, 2\n    add t0, a0, t0\n    addi t0, t0, -4      # t0 = &arr[n-1]\nloop:\n    bgeu a0, t0, done   # pointers met or crossed\n    lw t1, 0(a0)\n    lw t2, 0(t0)\n    sw t2, 0(a0)\n    sw t1, 0(t0)\n    addi a0, a0, 4\n    addi t0, t0, -4\n    j loop\ndone:\n    jr ra\n',
      explain: 'Two pointers walking inward. Remember to scale the index by 4 (<code>slli</code> by 2) because ints are 4 bytes. n = 0 must not touch memory: <code>&amp;arr[-1] &lt; arr</code>, so the loop exits immediately.',
      test: { fn: 'reverse', cases: [
        { args: [{ words: [1, 2, 3, 4, 5] }, 5], expect: { words: { arg: 0, values: [5, 4, 3, 2, 1] } } },
        { args: [{ words: [9, 8] }, 2], expect: { words: { arg: 0, values: [8, 9] } } },
        { args: [{ words: [42] }, 1], expect: { words: { arg: 0, values: [42] } } },
        { args: [{ words: [1, 2, 3, 4] }, 0], expect: { words: { arg: 0, values: [1, 2, 3, 4] } } }] },
    }],
  });

  P.push({
    id: 'o-pow', title: 'Recursive power (prologue/epilogue)', topic: 'riscv', difficulty: 3, source: 'Original', points: 8,
    intro: `<pre>int power(int x, int n) {   // n >= 0
    if (n == 0) return 1;
    int half = power(x, n / 2);
    int r = half * half;
    if (n & 1) r = r * x;
    return r;
}</pre><p>Fill in the blanks so <code>power</code> follows the calling convention. Use the fewest stack slots that work.</p>`,
    parts: [{
      type: 'fill', id: 'fill',
      template: 'power:\n    bnez a1, recurse\n    li a0, 1\n    jr ra\nrecurse:\n    [[p1]]\n    [[p2]]\n    [[p3]]\n    [[p4]]\n    mv s0, a0          # s0 = x\n    mv s1, a1          # s1 = n\n    [[c1]]\n    jal ra, power\n    mul a0, a0, a0\n    andi t0, s1, 1\n    beqz t0, out\n    [[c2]]\nout:\n    [[e1]]\n    [[e2]]\n    [[e3]]\n    [[e4]]\n    jr ra\n',
      blanks: { p1: ['addi sp, sp, -12'], p2: ['sw ra, 0(sp)'], p3: ['sw s0, 4(sp)'], p4: ['sw s1, 8(sp)'], c1: ['srli a1, a1, 1', 'srai a1, a1, 1'],
        c2: ['mul a0, a0, s0'], e1: ['lw ra, 0(sp)'], e2: ['lw s0, 4(sp)'], e3: ['lw s1, 8(sp)'], e4: ['addi sp, sp, 12'] },
      explain: 'Three things must survive the recursive call: <code>ra</code> (the call overwrites it), and <code>s0</code>/<code>s1</code> (we use them, and they are callee-saved, so we must restore the caller\'s values). <code>x</code> lives in <code>s0</code> so it is still there after the call. Stores and loads can be in any order as long as offsets match.',
      test: { fn: 'power', cases: [
        { args: [2, 0], expect: { a0: 1 } }, { args: [2, 10], expect: { a0: 1024 } }, { args: [3, 5], expect: { a0: 243 } },
        { args: [-2, 3], expect: { a0: -8 } }, { args: [7, 1], expect: { a0: 7 } }] },
    }],
  });

  P.push({
    id: 'o-lens', title: 'Lengths of strings (calling a function in a loop)', topic: 'riscv', difficulty: 3, source: 'Original', points: 10,
    intro: `<pre>// Writes strlen(strs[i]) into out[i] for each i; returns the total length.
int lengths(char **strs, int n, int *out);</pre><p>You may call <code>strlen</code> (it follows the calling convention, so it may clobber any <code>t</code>/<code>a</code> register). The harness really does trash those registers when <code>strlen</code> returns.</p>`,
    parts: [{
      type: 'code', id: 'code',
      starter: 'lengths:\n    # a0 = strs, a1 = n, a2 = out\n\n    jr ra\n',
      solution: 'lengths:\n    addi sp, sp, -24\n    sw ra, 0(sp)\n    sw s0, 4(sp)\n    sw s1, 8(sp)\n    sw s2, 12(sp)\n    sw s3, 16(sp)\n    mv s0, a0          # strs cursor\n    mv s1, a1          # remaining\n    mv s2, a2          # out cursor\n    li s3, 0           # total\nloop:\n    beqz s1, done\n    lw a0, 0(s0)\n    jal ra, strlen\n    sw a0, 0(s2)\n    add s3, s3, a0\n    addi s0, s0, 4\n    addi s2, s2, 4\n    addi s1, s1, -1\n    j loop\ndone:\n    mv a0, s3\n    lw ra, 0(sp)\n    lw s0, 4(sp)\n    lw s1, 8(sp)\n    lw s2, 12(sp)\n    lw s3, 16(sp)\n    addi sp, sp, 24\n    jr ra\n',
      explain: 'Anything you need after <code>jal strlen</code> must be in an <code>s</code> register (or on the stack). That means four <code>s</code> registers plus <code>ra</code>, all saved in the prologue. A common bug is keeping the loop counter in <code>t0</code>: it works until the callee happens to use <code>t0</code>.',
      test: { fn: 'lengths', cases: [
        { args: [{ strs: ['61c', '', 'risc-v'] }, 3, { words: [0, 0, 0] }], expect: { a0: 9, words: { arg: 2, values: [3, 0, 6] } } },
        { args: [{ strs: [] }, 0, { words: [7] }], expect: { a0: 0, words: { arg: 2, values: [7] } } },
        { args: [{ strs: ['a', 'bb', 'ccc', 'dddd'] }, 4, { words: [0, 0, 0, 0] }], expect: { a0: 10, words: { arg: 2, values: [1, 2, 3, 4] } } }] },
    }],
  });

  P.push({
    id: 'o-swaphalves', title: 'Swap halfwords in a uint16 array', topic: 'riscv', difficulty: 2, source: 'Original', points: 5,
    intro: `<pre>// For each 16-bit element, swap its two bytes (0xABCD -> 0xCDAB). n >= 1.
void swap_bytes(uint16_t *v, int n);</pre><p>Fill in the blanks. Watch out for sign extension.</p>`,
    parts: [{
      type: 'fill', id: 'fill',
      template: 'swap_bytes:\n    [[b1]]          # t0 = v[i]\n    srli t1, t0, 8\n    [[b2]]          # t2 = low byte moved up\n    or t0, t1, t2\n    [[b3]]          # store back\n    addi a0, a0, 2\n    addi a1, a1, -1\n    [[b4]]\n    jr ra\n',
      blanks: { b1: ['lhu t0, 0(a0)'], b2: ['slli t2, t0, 8'], b3: ['sh t0, 0(a0)'], b4: ['bnez a1, swap_bytes', 'bne a1, x0, swap_bytes', 'bgtz a1, swap_bytes', 'blt x0, a1, swap_bytes'] },
      explain: '<code>lh</code> would sign-extend 0x8000-range values, filling the upper bits with 1s; then <code>srli t1, t0, 8</code> drags those 1s into bits 8–15. <code>lhu</code> zero-extends. The high garbage from <code>slli</code> is harmless because <code>sh</code> only stores the low 16 bits.',
      test: { fn: 'swap_bytes', cases: [
        { args: [{ halves: [0xABCD] }, 1], expect: { halves: { arg: 0, values: [0xCDAB] } } },
        { args: [{ halves: [0x1234, 0x80FF, 0x00FF] }, 3], expect: { halves: { arg: 0, values: [0x3412, 0xFF80, 0xFF00] } } },
        { args: [{ halves: [0x8012, 0x9A01] }, 2], expect: { halves: { arg: 0, values: [0x1280, 0x019A] } } }] },
    }],
  });

  // ================================== Instruction translation ==================================
  P.push({
    id: 'o-tr-sw', title: 'Encode a store', topic: 'translate', difficulty: 1, source: 'Original', points: 2,
    intro: '<p>Translate to 32-bit hexadecimal machine code:</p><pre>sw s1, -12(sp)</pre>',
    parts: [{ type: 'short', id: 'a', prompt: 'Machine code', kind: 'hex', answer: 0xFE912A23,
      explain: 'S-type: imm = -12 = 0xFF4 → imm[11:5] = 1111111, imm[4:0] = 10100. rs2 = s1 = x9, rs1 = sp = x2, funct3 = 010, opcode 0100011.<br><code>1111111 01001 00010 010 10100 0100011</code> = 0xFE912A23' }],
  });
  P.push({
    id: 'o-tr-decode', title: 'Decode machine code', topic: 'translate', difficulty: 2, source: 'Original', points: 2,
    intro: '<p>What instruction is <code>0x40A5D513</code>? Use ABI register names.</p>',
    parts: [{ type: 'short', id: 'a', prompt: 'Instruction', kind: 'asm', answer: 'srai a0, a1, 10',
      explain: 'opcode 0010011 (I-type arithmetic), funct3 101 = shift right; bit 30 set → arithmetic. rd = 01010 (a0), rs1 = 01011 (a1), shamt = 01010 = 10.' }],
  });
  P.push({
    id: 'o-tr-branch', title: 'Encode a backward branch', topic: 'translate', difficulty: 2, source: 'Original', points: 3,
    intro: '<pre>0x40  loop:  lw   t1, 0(a0)\n0x44         addi a0, a0, 4\n0x48         addi t0, t0, -1\n0x4C         bne  t0, x0, loop     # translate this line</pre>',
    parts: [{ type: 'short', id: 'a', prompt: 'Machine code for line 0x4C', kind: 'hex', answer: 0xFE029AE3,
      explain: 'Offset = 0x40 − 0x4C = −12. B-type stores imm[12|10:5] and imm[4:1|11]: −12 = 1 1111 1111 0100 (13 bits) → imm[12]=1, imm[10:5]=111111, imm[4:1]=1010, imm[11]=1. rs1 = t0 (x5), rs2 = x0, funct3 = 001.' }],
  });
  P.push({
    id: 'o-tr-jal', title: 'Encode a forward jal', topic: 'translate', difficulty: 2, source: 'Original', points: 3,
    intro: '<pre>0x100      jal ra, helper\n...\n0x1A8  helper:  ...</pre><p>Translate the <code>jal</code>.</p>',
    parts: [{ type: 'short', id: 'a', prompt: 'Machine code', kind: 'hex', answer: 0x0A8000EF,
      explain: 'Offset = 0x1A8 − 0x100 = 0xA8 = 168. J-type bit layout is imm[20|10:1|11|19:12]: imm[10:1] = 0001010100, the rest 0. rd = ra = x1, opcode 1101111.' }],
  });
  P.push({
    id: 'o-tr-li', title: 'What does li become?', topic: 'translate', difficulty: 3, source: 'Original', points: 3,
    intro: '<p><code>li t0, 0x12345FFF</code> expands to <code>lui t0, X</code> followed by <code>addi t0, t0, Y</code>. Give X (hex) and Y (decimal).</p>',
    parts: [
      { type: 'short', id: 'x', prompt: 'X (lui immediate)', kind: 'hex', answer: 0x12346 },
      { type: 'short', id: 'y', prompt: 'Y (addi immediate)', kind: 'int', answer: -1,
        explain: 'The addi immediate is sign-extended. The low 12 bits 0xFFF would be read as −1, so lui must load one more than the upper bits: 0x12346000 + (−1) = 0x12345FFF.' }],
  });

  // ==================================== Calling convention ====================================
  P.push({
    id: 'o-cc-1', title: 'What must be saved? (1)', topic: 'callconv', difficulty: 1, source: 'Original', points: 3,
    intro: '<pre>f:\n    addi t0, a0, 1\n    add  s2, t0, a1\n    jal  ra, g\n    add  a0, a0, s2\n    jr   ra</pre><p>Select the minimum set of registers <code>f</code> must save/restore on the stack to follow the calling convention.</p>',
    parts: [{ type: 'mcq', id: 'a', multi: true, options: ['t0', 's2', 'a0', 'a1', 'ra', 'None of these'], answer: [1, 4],
      explain: '<code>s2</code> is callee-saved and <code>f</code> overwrites it → save. <code>ra</code> is overwritten by <code>jal</code> and needed for <code>jr ra</code> → save. <code>t0</code> isn\'t used after the call, so no need to save it.' }],
  });
  P.push({
    id: 'o-cc-2', title: 'What must be saved? (2)', topic: 'callconv', difficulty: 2, source: 'Original', points: 3,
    intro: '<pre>h:\n    mv   t1, a0\n    li   a0, 5\n    jal  ra, k\n    add  a0, a0, t1\n    mv   s0, a0\n    addi a0, s0, 1\n    jr   ra</pre><p>Select the minimum set of registers that must be saved/restored somewhere for <code>h</code> to work correctly <em>and</em> follow the convention.</p>',
    parts: [{ type: 'mcq', id: 'a', multi: true, options: ['t1', 's0', 'a0', 'ra', 'None of these'], answer: [0, 1, 3],
      explain: '<code>t1</code> is used after the call, and <code>k</code> may clobber it, so the caller must save it. <code>s0</code> is written, so <code>h</code> must restore it (even though it only uses it after the call). <code>ra</code> is overwritten by <code>jal</code>.' }],
  });
  P.push({
    id: 'o-cc-3', title: 'Find the convention bug', topic: 'callconv', difficulty: 2, source: 'Original', points: 3,
    intro: '<pre>sum3:            # returns a0 + a1 + a2 using helper add2(a, b)\n    addi sp, sp, -8\n    sw   ra, 0(sp)\n    sw   a2, 4(sp)\n    jal  ra, add2      # a0 = a0 + a1\n    lw   a1, 4(sp)\n    jal  ra, add2\n    lw   ra, 0(sp)\n    jr   ra</pre>',
    parts: [{ type: 'mcq', id: 'a', options: ['Saving a2 is unnecessary', 'It never restores sp', 'It should save s0', 'ra is restored too early', 'It is correct'], answer: 1,
      explain: 'The epilogue forgets <code>addi sp, sp, 8</code>. Saving <code>a2</code> is required (caller-saved, needed after the call).' }],
  });

  // ==================================== Datapath & control ====================================
  const SIGROWS = (ans) => ['PCSel', 'ImmSel', 'ASel', 'BSel', 'ALUSel', 'MemRW', 'RegWEn', 'WBSel'].map(s => ({ sig: s, ans: ans[s] }));
  P.push({
    id: 'o-dp-jalm', title: 'New instruction: jalm (jump through memory)', topic: 'datapath', difficulty: 3, source: 'Original', points: 10,
    intro: '<p>We add <code>jalm rd, imm(rs1)</code> to the single-cycle datapath:</p><pre>R[rd] = PC + 4\nPC    = Mem[R[rs1] + imm]</pre><p>(Think of a jump table of function pointers.)</p>',
    parts: [
      { type: 'mcq', id: 'fmt', prompt: 'Most suitable existing format:', options: ['R', 'I', 'S', 'B', 'U', 'J'], answer: 1, explain: 'One source register, one destination, a 12-bit immediate: I-type, like <code>lw</code>/<code>jalr</code>.' },
      { type: 'mcq', id: 'chg', multi: true, prompt: 'Minimal datapath changes (select all):', options: [
        'New ImmGen format', 'Third input on ASel', 'Third input on BSel', 'Feed DMEM read data into the PCSel mux (new PCSel value)',
        'Fourth input on WBSel', 'Second RegFile write port', 'New adder', 'None of the above'], answer: [3],
        explain: 'The ALU computes R[rs1]+imm as the address (like <code>lw</code>); write-back of PC+4 already exists (like <code>jal</code>). The only missing wire is from DMEM output to the PC mux.' },
      { type: 'signals', id: 'sig', prompt: 'Control signals for jalm (PCSel "Mem" = the new input):', rows: SIGROWS({ PCSel: 'Mem', ImmSel: 'I', ASel: 'Reg', BSel: 'Imm', ALUSel: 'add', MemRW: 'Read', RegWEn: '1', WBSel: 'PC+4' }),
        extraOpts: { PCSel: ['Mem'] } },
    ],
  });
  P.push({
    id: 'o-dp-addm', title: 'New instruction: addm (add from memory)', topic: 'datapath', difficulty: 3, source: 'Original', points: 10,
    intro: '<pre>addm rd, rs1, rs2:   R[rd] = R[rs1] + Mem[R[rs2]]</pre>',
    parts: [
      { type: 'mcq', id: 'one', prompt: 'Can the unmodified single-cycle datapath do this in one cycle?', options: [
        'Yes, it is like lw followed by add', 'No: memory is read after the ALU, so the ALU cannot use the loaded value', 'No: the RegFile cannot read two registers', 'No: there is no R-type memory access'], answer: 1,
        explain: 'In the standard datapath the ALU computes the memory address, and DMEM sits after the ALU. The add would need the ALU <em>after</em> memory.' },
      { type: 'mcq', id: 'chg', multi: true, prompt: 'One valid minimal set of changes (select all):', options: [
        'A mux on the DMEM address so it can take R[rs2] directly', 'Third BSel input: DMEM read data', 'New ImmGen type', 'Second DMEM read port',
        'Fourth WBSel input', 'Second RegFile write port', 'None of the above'], answer: [0, 1],
        explain: 'Address comes straight from rs2 (no ALU needed), the loaded word feeds the ALU\'s B input, the ALU adds R[rs1], and WBSel = ALU writes it back. This creates a long combinational path (RegFile → DMEM → ALU → RegFile), which hurts the clock period.' },
      { type: 'signals', id: 'sig', prompt: 'Control signals (BSel "Mem" = new input):', rows: SIGROWS({ PCSel: 'PC+4', ImmSel: '*', ASel: 'Reg', BSel: 'Mem', ALUSel: 'add', MemRW: 'Read', RegWEn: '1', WBSel: 'ALU' }),
        extraOpts: { BSel: ['Mem'] } },
    ],
  });
  P.push({
    id: 'o-dp-bez', title: 'New instruction: bez (branch if zero)', topic: 'datapath', difficulty: 2, source: 'Original', points: 6,
    intro: '<pre>bez rs1, label:   if (R[rs1] == 0) PC = PC + offset</pre><p>It is encoded as B-type with the rs2 field set to 0.</p>',
    parts: [
      { type: 'mcq', id: 'one', prompt: 'Datapath changes needed?', options: ['None', 'New comparator input for 0', 'New ImmGen type', 'New PCSel input'], answer: 0,
        explain: 'With rs2 = x0, reading register x0 gives 0, so the existing comparator checks R[rs1] == 0. It is exactly <code>beq rs1, x0, label</code>.' },
      { type: 'signals', id: 'sig', prompt: 'Control signals:', rows: SIGROWS({ PCSel: 'Br', ImmSel: 'B', ASel: 'PC', BSel: 'Imm', ALUSel: 'add', MemRW: 'Read', RegWEn: '0', WBSel: '*' }) },
    ],
  });
  P.push({
    id: 'o-dp-timing', title: 'Critical path of a single-cycle CPU', topic: 'datapath', difficulty: 2, source: 'Original', points: 4,
    intro: '<p>Delays: clk-to-q 30 ps, IMEM read 200, RegFile read 150, ImmGen 40, mux 20, ALU 180, BranchComp 70, DMEM read 250, RegFile setup 20, +4 adder 50. Assume ImmGen runs in parallel with the RegFile read.</p>',
    parts: [
      { type: 'short', id: 'lw', prompt: 'Time for lw (ps), from rising edge to RegFile setup', kind: 'int', answer: 870,
        explain: 'clk-to-q 30 + IMEM 200 + RegFile read 150 (longer than ImmGen 40) + BSel mux 20 + ALU 180 + DMEM 250 + WBSel mux 20 + setup 20 = 870 ps.' },
      { type: 'short', id: 'beq', prompt: 'Time for a taken beq to update PC (ps), PC register setup = 20', kind: 'int', answer: 620,
        explain: 'A/B path: 30 + 200 + 150 + mux 20 + ALU 180 = 580; branch comp path: 30+200+150+70 = 450 (shorter). Then PCSel mux 20 + PC setup 20 → 620 ps. lw is the critical path, so the clock period is ≥ 870 ps.' },
    ],
  });

  if (typeof window !== 'undefined') window.ORIGINAL_PROBLEMS = P;
  if (typeof module !== 'undefined') module.exports = P;
})();
