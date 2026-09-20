/**
 * 应用装配：连接 Worker、网格、公式栏、SVG 依赖图与各面板。
 */
import { WorkbookEngineWorker } from './worker-client.js';
import { GridView, ROWS, COLS } from './ui/grid.js';
import { FormulaBar } from './ui/formula-bar.js';
import { GraphView } from './ui/graph-view.js';
import { renderAstTree } from './ui/ast-tree.js';
import { renderRecalcOrder } from './ui/panel-recalc.js';
import { renderErrorList } from './ui/panel-errors.js';
import { renderDebugPanel } from './ui/panel-debug.js';
import { state, normalizeRange } from './ui/state.js';
import { formatAddr, lettersToCol } from './core/address.js';
import type { EngineSnapshot } from './core/types.js';
import { sampleData } from './sample-data.js';

export class App {
  private readonly worker: WorkbookEngineWorker;
  private readonly grid: GridView;
  private readonly formulaBar: FormulaBar;
  private readonly graph: GraphView;
  private panels!: Record<string, HTMLElement>;
  private astContainer!: HTMLElement;

  constructor() {
    this.worker = new WorkbookEngineWorker((snapshot) => this.onSnapshot(snapshot));

    this.formulaBar = new FormulaBar({
      onCommit: (row, col, raw) => this.worker.setCell(row, col, raw),
      onActiveMove: (row, col) => this.selectCell(row, col),
    });

    this.grid = new GridView({
      onEdit: (row, col, raw) => this.worker.setCell(row, col, raw),
      onActiveChange: (row, col) => this.onActiveChange(row, col),
    });

    this.graph = new GraphView({
      onNodeSelect: (addr) => {
        if (addr) {
          const { row, col } = parseAddr(addr);
          this.selectCell(row, col, true);
        }
      },
      onHighlight: (upstream, downstream, active) => {
        state.graphHighlight = { upstream, downstream, active };
        this.grid.renderOverlay();
      },
    });
  }

  mount(root: HTMLElement): void {
    root.innerHTML = '';
    const layout = document.createElement('div');
    layout.className = 'app-layout';

    const toolbar = this.buildToolbar();
    layout.appendChild(toolbar);
    layout.appendChild(this.formulaBar.root);

    const split = document.createElement('div');
    split.className = 'main-split';
    split.appendChild(this.grid.root);

    const side = document.createElement('div');
    side.className = 'side-panel';
    this.astContainer = document.createElement('div');
    this.astContainer.className = 'ast-container';
    const astHeader = document.createElement('div');
    astHeader.className = 'panel-title';
    astHeader.textContent = 'AST 树';
    side.append(astHeader, this.astContainer);
    split.appendChild(side);
    layout.appendChild(split);

    const bottom = this.buildBottomPanel();
    layout.appendChild(bottom);

    root.appendChild(layout);

    // 载入示例数据
    this.worker.load(sampleData(ROWS, COLS));
  }

  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    const title = document.createElement('span');
    title.className = 'toolbar-title';
    title.textContent = '电子表格公式引擎';
    bar.appendChild(title);

    const label = document.createElement('label');
    label.className = 'toolbar-group';
    label.textContent = '拓扑算法 ';
    const select = document.createElement('select');
    for (const algo of ['kahn', 'dfs'] as const) {
      const opt = document.createElement('option');
      opt.value = algo;
      opt.textContent = algo === 'kahn' ? 'Kahn' : 'DFS 三色';
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      this.worker.setAlgorithm(select.value as 'kahn' | 'dfs');
    });
    label.appendChild(select);
    bar.appendChild(label);

    const recalc = document.createElement('button');
    recalc.textContent = '强制全量重算';
    recalc.addEventListener('click', () => this.worker.recalc());
    bar.appendChild(recalc);

    const sample = document.createElement('button');
    sample.textContent = '重置示例数据';
    sample.addEventListener('click', () => this.worker.load(sampleData(ROWS, COLS)));
    bar.appendChild(sample);

    return bar;
  }

  private buildBottomPanel(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'bottom-panel';
    const tabs = document.createElement('div');
    tabs.className = 'bottom-tabs';
    const bodies = document.createElement('div');
    bodies.className = 'bottom-bodies';

    const defs = [
      { key: 'graph', label: '依赖图 SVG', content: this.graph.root },
      { key: 'recalc', label: '重算顺序', content: document.createElement('div') },
      { key: 'errors', label: '错误列表', content: document.createElement('div') },
      { key: 'debug', label: '调试', content: document.createElement('div') },
    ];
    this.panels = {
      recalc: defs[1]!.content as HTMLElement,
      errors: defs[2]!.content as HTMLElement,
      debug: defs[3]!.content as HTMLElement,
    };
    for (const c of Object.values(this.panels)) c.className = 'tab-body';
    this.graph.root.classList.add('tab-body');

    defs.forEach((def, i) => {
      const tab = document.createElement('button');
      tab.className = 'bottom-tab' + (i === 0 ? ' active' : '');
      tab.textContent = def.label;
      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.bottom-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        bodies.querySelectorAll('.tab-body').forEach((b) => (b as HTMLElement).style.display = 'none');
        def.content.style.display = 'flex';
        if (def.key === 'graph') requestAnimationFrame(() => this.graph.fit());
        this.refreshActivePanel(def.key);
      });
      tabs.appendChild(tab);
      def.content.style.display = i === 0 ? 'flex' : 'none';
      bodies.appendChild(def.content);
    });

    wrap.append(tabs, bodies);
    return wrap;
  }

  private activeTab = 'graph';
  private refreshActivePanel(key: string): void {
    this.activeTab = key;
    if (key === 'recalc') {
      renderRecalcOrder(this.panels.recalc!, (addr) => {
        const { row, col } = parseAddr(addr);
        this.selectCell(row, col);
      });
    } else if (key === 'errors') {
      renderErrorList(this.panels.errors!, (addr) => {
        const { row, col } = parseAddr(addr);
        this.selectCell(row, col);
      });
    } else if (key === 'debug') {
      renderDebugPanel(this.panels.debug!);
    }
  }

  private onSnapshot(snapshot: EngineSnapshot): void {
    state.snapshot = snapshot;
    this.grid.renderValues();
    this.formulaBar.sync();
    this.graph.setSnapshot(snapshot.graph);
    this.graph.focusAddress(formatAddr(state.selection.active));
    renderAstTree(
      snapshot.cells[formatAddr(state.selection.active)]?.ast,
      this.astContainer,
    );
    if (this.activeTab !== 'graph') this.refreshActivePanel(this.activeTab);
  }

  private onActiveChange(row: number, col: number): void {
    this.formulaBar.sync();
    const addr = formatAddr({ row, col });
    this.graph.focusAddress(addr);
    renderAstTree(state.snapshot?.cells[addr]?.ast, this.astContainer);
  }

  private selectCell(row: number, col: number, fromGraph = false): void {
    state.selection.active = { row, col };
    state.selection.anchor = { row, col };
    state.selection.ranges = [normalizeRange({ row, col }, { row, col })];
    this.grid.renderOverlay();
    this.formulaBar.sync();
    const addr = formatAddr({ row, col });
    renderAstTree(state.snapshot?.cells[addr]?.ast, this.astContainer);
    if (!fromGraph) this.graph.focusAddress(addr);
    this.grid.focus();
  }
}

function parseAddr(addr: string): { row: number; col: number } {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(addr);
  if (!m) return { row: 0, col: 0 };
  return { row: Number(m[2]) - 1, col: lettersToCol(m[1]!) };
}
