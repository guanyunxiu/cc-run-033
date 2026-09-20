/**
 * 右侧面板集合：
 *  - AST 树展示（特性 12）
 *  - 重算顺序面板（特性 22、31）
 *  - 错误列表面板（特性 32）
 *  - 基础调试面板（特性 33）
 */
import { errorMessage } from '../engine/errors';
import type { Snapshot } from '../engine/protocol';
import { cellKey, UiState } from './state';

export interface PanelCallbacks {
  onSelectCell(col: number, row: number): void;
  getState(): UiState;
}

function parseKeyLocal(key: string): { col: number; row: number } {
  const m = /^([A-Z]+)([0-9]+)$/.exec(key)!;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2]!, 10) - 1 };
}

/* ---------------- AST 面板 ---------------- */
export class AstPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly cb: PanelCallbacks,
  ) {}

  update(state: UiState): void {
    const snapshot = state.snapshot;
    this.root.innerHTML = '';
    if (!snapshot) return;

    const key = cellKey(state.active.col, state.active.row);
    const cell = snapshot.cells[key];

    const sec = document.createElement('div');
    sec.className = 'panel-section';
    sec.innerHTML = `<h3>单元格 ${key} 的公式 AST</h3>`;

    if (!cell?.formulaText) {
      sec.insertAdjacentHTML(
        'beforeend',
        `<div class="empty-hint">该单元格不是公式。<br/>试试点击 E2、B7 等公式单元格。</div>`,
      );
      this.root.appendChild(sec);
      return;
    }

    const formulaLine = document.createElement('pre');
    formulaLine.className = 'debug-code';
    formulaLine.textContent = cell.formulaText;
    sec.appendChild(formulaLine);

    if (cell.parseError) {
      const err = document.createElement('div');
      err.style.color = 'var(--error)';
      err.style.fontFamily = 'var(--mono)';
      err.style.fontSize = '11px';
      const body = cell.formulaText.slice(1);
      const off = cell.parseError.offset;
      const pointer = ' '.repeat(off) + '^'.repeat(Math.max(1, cell.parseError.length));
      err.textContent = `语法错误（第 ${cell.parseError.column} 列）:\n${body}\n${pointer}\n${cell.parseError.message}`;
      sec.appendChild(err);
    } else if (cell.astTree) {
      const tree = document.createElement('pre');
      tree.className = 'ast-tree';
      tree.textContent = cell.astTree;
      sec.appendChild(tree);
    }
    this.root.appendChild(sec);
  }
}

/* ---------------- 重算顺序面板 ---------------- */
export class OrderPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly cb: PanelCallbacks,
  ) {}

  update(state: UiState): void {
    const snapshot = state.snapshot;
    this.root.innerHTML = '';
    if (!snapshot) return;

    const sec = document.createElement('div');
    sec.className = 'panel-section';
    sec.innerHTML = `<h3>全量重算顺序（${snapshot.algorithm.toUpperCase()} 拓扑排序，耗时 ${snapshot.stats.recalcMs.toFixed(2)} ms）</h3>
      <div style="color:var(--muted);font-size:11px;margin-bottom:6px">
      被依赖的单元格先求值；循环节点无法排序，以 #CYCLE! 结尾列出。</div>`;

    if (snapshot.cycles.length) {
      for (const cyc of snapshot.cycles) {
        const div = document.createElement('div');
        div.className = 'cycle-item';
        const kindText =
          cyc.kind === 'self' ? '自引用循环' : cyc.kind === 'direct' ? '直接循环' : '间接循环';
        const labels = cyc.members
          .filter((m) => m.startsWith('cell:'))
          .map((m) => m.slice('cell:'.length))
          .join(' → ');
        div.innerHTML = `<span class="kind">↻ ${kindText}</span>：${labels}`;
        sec.appendChild(div);
      }
    }

    const list = document.createElement('ul');
    list.className = 'order-list';
    for (const entry of snapshot.order) {
      const li = document.createElement('li');
      if (entry.kind === 'cycle') li.classList.add('cycle');
      li.innerHTML = `<span class="idx">${entry.index + 1}.</span><span class="key">${entry.key}</span><span>${entry.detail}</span>`;
      li.addEventListener('click', () => {
        const a = parseKeyLocal(entry.key);
        this.cb.onSelectCell(a.col, a.row);
      });
      list.appendChild(li);
    }
    sec.appendChild(list);
    this.root.appendChild(sec);
  }
}

/* ---------------- 错误列表面板 ---------------- */
export class ErrorsPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly cb: PanelCallbacks,
  ) {}

  update(state: UiState): void {
    const snapshot = state.snapshot;
    this.root.innerHTML = '';
    if (!snapshot) return;

    const sec = document.createElement('div');
    sec.className = 'panel-section';
    sec.innerHTML = `<h3>错误列表（${snapshot.errors.length}）</h3>`;

    if (snapshot.errors.length === 0) {
      sec.insertAdjacentHTML('beforeend', `<div class="empty-hint">没有错误值 🎉</div>`);
      this.root.appendChild(sec);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'error-list';
    for (const e of snapshot.errors) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div><span class="cell-key">${e.key}</span><span class="code">${e.code}</span></div>
        <div class="msg">${e.message} · ${e.source === 'formula' ? '公式' : '字面值'}</div>
        <div class="raw">${e.raw}</div>`;
      li.addEventListener('click', () => {
        const a = parseKeyLocal(e.key);
        this.cb.onSelectCell(a.col, a.row);
      });
      list.appendChild(li);
    }
    sec.appendChild(list);
    this.root.appendChild(sec);

    // 错误类型说明
    const ref = document.createElement('div');
    ref.className = 'panel-section';
    ref.innerHTML = `<h3>基础错误类型</h3>`;
    const codes: Array<[string, string]> = [
      ['#DIV/0!', errorMessage('#DIV/0!')],
      ['#VALUE!', errorMessage('#VALUE!')],
      ['#REF!', errorMessage('#REF!')],
      ['#NAME?', errorMessage('#NAME?')],
      ['#N/A', errorMessage('#N/A')],
      ['#CYCLE!', errorMessage('#CYCLE!')],
    ];
    const ul = document.createElement('ul');
    ul.className = 'error-list';
    for (const [code, msg] of codes) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="code">${code}</span> <span class="msg">${msg}</span>`;
      ul.appendChild(li);
    }
    ref.appendChild(ul);
    this.root.appendChild(ref);
  }
}

/* ---------------- 调试面板 ---------------- */
export class DebugPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly cb: PanelCallbacks,
  ) {}

  update(state: UiState): void {
    const snapshot = state.snapshot;
    this.root.innerHTML = '';
    if (!snapshot) return;
    const key = cellKey(state.active.col, state.active.row);
    const cell = snapshot.cells[key];
    const deps = snapshot.formulaDeps[key];

    const sec = document.createElement('div');
    sec.className = 'panel-section';
    sec.innerHTML = `<h3>调试：${key}</h3>`;

    const dl = document.createElement('dl');
    dl.className = 'debug-grid';
    const rows: Array<[string, string]> = [
      ['原始输入', cell?.raw ?? '（空）'],
      ['解析类型', cell ? statusName(cell.status) : '空值'],
      ['值类型', cell ? cell.valueType : 'empty'],
      ['显示值', cell?.display ?? ''],
      ['是否公式', cell?.formulaText ? '是' : '否'],
      ['循环节点', cell?.cyclic ? '是 ⚠' : '否'],
      [
        '语法错误',
        cell?.parseError ? `第 ${cell.parseError.column} 列：${cell.parseError.message}` : '无',
      ],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    sec.appendChild(dl);

    // 类型徽章
    const badges = document.createElement('div');
    badges.className = 'kv-badges';
    badges.style.marginTop = '8px';
    if (cell?.formulaText) badges.insertAdjacentHTML('beforeend', `<span class="badge type-formula">formula</span>`);
    badges.insertAdjacentHTML(
      'beforeend',
      `<span class="badge type-${cell?.valueType ?? 'empty'}">${cell?.valueType ?? 'empty'}</span>`,
    );
    sec.appendChild(badges);
    this.root.appendChild(sec);

    // 依赖信息
    const depSec = document.createElement('div');
    depSec.className = 'panel-section';
    depSec.innerHTML = `<h3>AST 提取的依赖引用</h3>`;
    if (!deps) {
      depSec.insertAdjacentHTML('beforeend', `<div class="empty-hint">无公式依赖</div>`);
    } else {
      const list = (...items: string[]): string =>
        items.length ? items.map((i) => `<span class="badge type-number">${i}</span>`).join(' ') : '（无）';
      const div = document.createElement('div');
      div.style.fontSize = '11px';
      div.innerHTML = `
        <div style="margin-bottom:6px"><strong>单元格依赖：</strong>${list(...deps.cells.map((c) => cellKey(c.col, c.row)))}</div>
        <div><strong>区域依赖：</strong>${list(...deps.ranges.map((r) => r.text))}</div>`;
      depSec.appendChild(div);
    }
    this.root.appendChild(depSec);

    // 图统计
    const statSec = document.createElement('div');
    statSec.className = 'panel-section';
    statSec.innerHTML = `<h3>引擎统计（Worker 内计算）</h3>`;
    const s = snapshot.stats;
    statSec.insertAdjacentHTML(
      'beforeend',
      `<pre class="debug-code">单元格: ${s.cellCount}
公式:   ${s.formulaCount}
图节点: ${s.nodeCount}（cell / formula / range）
图边:   ${s.edgeCount}（owns / references / covers）
重算耗时: ${s.recalcMs.toFixed(3)} ms
拓扑算法: ${snapshot.algorithm.toUpperCase()}</pre>`,
    );
    this.root.appendChild(statSec);
  }
}

function statusName(status: Snapshot['cells'][string]['status']): string {
  switch (status) {
    case 'empty':
      return '空值';
    case 'literal':
      return '字面值';
    case 'formula':
      return '公式';
    case 'parse-error':
      return '公式语法错误';
  }
}
