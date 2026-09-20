/**
 * 应用入口：组装工具栏、公式栏、网格、右侧面板，
 * 并通过 EngineClient（Web Worker）与引擎通信（特性 34、35）。
 */
import './style.css';
import type { Snapshot } from './engine/protocol';
import { GraphView } from './ui/graph';
import { GridView, GRID_COLS, GRID_ROWS } from './ui/grid';
import {
  AstPanel,
  DebugPanel,
  ErrorsPanel,
  OrderPanel,
} from './ui/panels';
import {
  cellKey,
  createInitialState,
  EngineClient,
  RangeSelection,
  Selection,
  SideTab,
  UiState,
} from './ui/state';

function bootstrap(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="toolbar">
      <span class="title">📊 电子表格公式引擎</span>
      <button data-act="sample">载入示例</button>
      <button data-act="clear">清空</button>
      <label style="font-size:12px;color:var(--muted)">拓扑算法
        <select data-act="algorithm">
          <option value="kahn">Kahn</option>
          <option value="dfs">DFS 三色标记</option>
        </select>
      </label>
      <div class="spacer"></div>
      <span class="stat" data-stat></span>
    </div>
    <div class="formula-bar">
      <div class="name-box" data-name-box>B2</div>
      <span class="fx">fx</span>
      <input data-formula-input spellcheck="false" placeholder="输入公式（以 = 开头）或值，回车提交" />
      <span class="parse-hint" data-parse-hint></span>
    </div>
    <div class="main">
      <div class="sheet-area" data-sheet></div>
      <div class="side">
        <div class="tabs">
          <button data-tab="graph">依赖图</button>
          <button data-tab="ast">AST</button>
          <button data-tab="order">重算顺序</button>
          <button data-tab="errors">错误列表</button>
          <button data-tab="debug">调试</button>
        </div>
        <div class="tab-body" data-tab-body></div>
      </div>
    </div>
  `;

  const state = createInitialState();

  const sheetEl = app.querySelector<HTMLElement>('[data-sheet]')!;
  const tabBody = app.querySelector<HTMLElement>('[data-tab-body]')!;
  const formulaInput = app.querySelector<HTMLInputElement>('[data-formula-input]')!;
  const nameBox = app.querySelector<HTMLElement>('[data-name-box]')!;
  const parseHint = app.querySelector<HTMLElement>('[data-parse-hint]')!;
  const statEl = app.querySelector<HTMLElement>('[data-stat]')!;
  const algorithmSelect = app.querySelector<HTMLSelectElement>('[data-act="algorithm"]')!;

  const client = new EngineClient((snapshot: Snapshot) => {
    state.snapshot = snapshot;
    renderAll();
  });

  /* ---------------- 网格 ---------------- */
  const grid = new GridView(sheetEl, {
    getState: () => state,
    onSelectionChange: (active, box, multi) => {
      state.active = active;
      state.box = box;
      state.multi = multi;
      renderAll();
    },
    onEditCommit: (col, row, raw) => {
      client.setCell(col, row, raw);
    },
    onEditStart: () => {
      syncFormulaInput(true);
    },
    onEditEnd: () => {
      renderAll();
    },
  });

  /* ---------------- 图与面板（懒挂载/切换） ---------------- */
  const graphHost = document.createElement('div');
  graphHost.style.width = '100%';
  graphHost.style.height = '100%';
  const graph = new GraphView(graphHost, {
    getState: () => state,
    onSelectCell: (col, row) => {
      selectCell({ col, row }, null, new Set());
      state.tab = 'graph';
      setActiveTab('graph');
    },
    onHoverNode: (id) => {
      if (state.hoverNode === id) return; // 避免重绘后重复触发 mouseenter 形成循环
      state.hoverNode = id;
      graph.update(state);
    },
  });

  const astPanel = new AstPanel(tabBody, {
    getState: () => state,
    onSelectCell: (col, row) => selectCell({ col, row }, null, new Set()),
  });
  const orderPanel = new OrderPanel(tabBody, {
    getState: () => state,
    onSelectCell: (col, row) => selectCell({ col, row }, null, new Set()),
  });
  const errorsPanel = new ErrorsPanel(tabBody, {
    getState: () => state,
    onSelectCell: (col, row) => selectCell({ col, row }, null, new Set()),
  });
  const debugPanel = new DebugPanel(tabBody, {
    getState: () => state,
    onSelectCell: (col, row) => selectCell({ col, row }, null, new Set()),
  });

  function setActiveTab(tab: SideTab): void {
    state.tab = tab;
    app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    renderTab();
  }

  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => setActiveTab(b.dataset.tab as SideTab));
  });

  function renderTab(): void {
    if (!state.snapshot) return;
    if (state.tab === 'graph') {
      tabBody.innerHTML = '';
      tabBody.appendChild(graphHost);
      graph.update(state);
      return;
    }
    if (tabBody.contains(graphHost)) tabBody.removeChild(graphHost);
    tabBody.innerHTML = '';
    switch (state.tab) {
      case 'ast':
        astPanel.update(state);
        break;
      case 'order':
        orderPanel.update(state);
        break;
      case 'errors':
        errorsPanel.update(state);
        break;
      case 'debug':
        debugPanel.update(state);
        break;
    }
  }

  /* ---------------- 选择联动 ---------------- */
  function selectCell(active: Selection, box: RangeSelection | null, multi: Set<string>): void {
    state.active = active;
    state.box = box;
    state.multi = multi;
    state.selectedGraphNode = null;
    renderAll();
    if (state.tab === 'graph') graph.focusCell(active.col, active.row);
  }

  /* ---------------- 公式栏（特性 4） ---------------- */
  function syncFormulaInput(editing: boolean): void {
    const key = cellKey(state.active.col, state.active.row);
    nameBox.textContent = key;
    if (!editing) {
      formulaInput.value = state.snapshot?.cells[key]?.raw ?? '';
    }
    formulaInput.classList.remove('has-error');
    parseHint.className = 'parse-hint';
    parseHint.textContent = '';
  }

  let previewTimer: number | undefined;
  formulaInput.addEventListener('input', () => {
    const raw = formulaInput.value;
    window.clearTimeout(previewTimer);
    if (!raw.startsWith('=')) {
      parseHint.className = 'parse-hint';
      parseHint.textContent = raw.trim() === '' ? '空值' : '将作为字面值保存（数字/文本/TRUE/FALSE/#错误）';
      return;
    }
    parseHint.className = 'parse-hint';
    parseHint.textContent = '解析中…';
    previewTimer = window.setTimeout(async () => {
      const res = await client.parsePreview(raw.slice(1));
      if (res.error) {
        parseHint.className = 'parse-hint error';
        parseHint.textContent = `语法错误（第 ${res.error.column} 列）：${res.error.message}`;
        formulaInput.classList.add('has-error');
      } else {
        parseHint.className = 'parse-hint ok';
        parseHint.textContent = '语法正确 ✓（回车提交，查看 AST 标签页了解结构）';
      }
    }, 120);
  });

  formulaInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      client.setCell(state.active.col, state.active.row, formulaInput.value);
      moveSelection(0, 1);
    } else if (e.key === 'Escape') {
      syncFormulaInput(false);
      formulaInput.blur();
    }
  });
  formulaInput.addEventListener('focus', () => {
    formulaInput.setSelectionRange(0, formulaInput.value.length);
  });

  /* ---------------- 键盘导航 ---------------- */
  function moveSelection(dc: number, dr: number): void {
    const col = Math.max(0, Math.min(GRID_COLS - 1, state.active.col + dc));
    const row = Math.max(0, Math.min(GRID_ROWS - 1, state.active.row + dr));
    selectCell({ col, row }, null, new Set());
  }

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === formulaInput) return;
    if (grid.isEditing()) return;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(0, -1);
        break;
      case 'ArrowDown':
      case 'Enter':
        e.preventDefault();
        moveSelection(0, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveSelection(-1, 0);
        break;
      case 'ArrowRight':
      case 'Tab':
        e.preventDefault();
        moveSelection(1, 0);
        break;
      case 'Delete':
      case 'Backspace':
        client.setCell(state.active.col, state.active.row, '');
        break;
      case 'F2':
        e.preventDefault();
        grid.startEdit(state.active.col, state.active.row);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          grid.startEdit(state.active.col, state.active.row, e.key);
        }
    }
  });

  /* ---------------- 工具栏 ---------------- */
  app.querySelector('[data-act="sample"]')!.addEventListener('click', () => {
    client.loadSample();
  });
  app.querySelector('[data-act="clear"]')!.addEventListener('click', () => {
    client.clear();
  });
  algorithmSelect.addEventListener('change', () => {
    client.setAlgorithm(algorithmSelect.value as 'kahn' | 'dfs');
  });

  /* ---------------- 统一刷新 ---------------- */
  function renderAll(): void {
    if (!state.snapshot) return;
    nameBox.textContent = cellKey(state.active.col, state.active.row);
    formulaInput.value =
      state.snapshot.cells[cellKey(state.active.col, state.active.row)]?.raw ?? '';
    formulaInput.classList.remove('has-error');
    parseHint.className = 'parse-hint';
    parseHint.textContent = '';

    const s = state.snapshot.stats;
    statEl.textContent =
      `${s.cellCount} 单元格 · ${s.formulaCount} 公式 · ${s.nodeCount} 节点 / ${s.edgeCount} 边 · ${s.recalcMs.toFixed(2)}ms`;

    grid.update(state.snapshot, state);
    renderTab();
  }

  setActiveTab('graph');
  client.loadSample();
}

bootstrap();
