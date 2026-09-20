/**
 * 网格组件（特性 1-4、29、30）。
 *
 * - 纯 DOM 渲染：26 列 × 100 行，表头 sticky
 * - 单击选择、拖拽框选、Ctrl/Cmd 多选、点击行/列标题整行整列选择
 * - 双击或键入进入编辑，Enter 提交到 Worker，方向键移动活动格
 * - 根据快照/图联动状态渲染上游（upstream）、下游（downstream）高亮
 */
import { colToLetters, formatAddr } from '../core/address.js';
import { state, normalizeRange, pointInRange, computeCellHighlight } from './state.js';
import { formatValue, valueClass } from './format.js';
import type { CellPoint } from './state.js';

export const ROWS = 100;
export const COLS = 26;
export const ROW_H = 24;
export const COL_W = 96;
export const HEADER_W = 48;
export const HEADER_H = 26;

export interface GridCallbacks {
  onEdit(row: number, col: number, raw: string): void;
  onActiveChange(row: number, col: number): void;
}

export class GridView {
  readonly root: HTMLDivElement;
  private readonly scroller: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly editor: HTMLTextAreaElement;
  private editing: { row: number; col: number } | null = null;
  private dragSelecting = false;

  constructor(private readonly cb: GridCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'grid-root';

    this.scroller = document.createElement('div');
    this.scroller.className = 'grid-scroller';

    this.body = document.createElement('div');
    this.body.className = 'grid-body';
    this.body.style.position = 'relative';

    this.buildSkeleton();
    this.scroller.appendChild(this.body);
    this.root.appendChild(this.scroller);

    this.editor = document.createElement('textarea');
    this.editor.className = 'cell-editor';
    this.editor.rows = 1;
    this.editor.style.display = 'none';
    this.body.appendChild(this.editor);

    this.bindEvents();
  }

  private buildSkeleton(): void {
    // 表头行（sticky top）
    const headerRow = document.createElement('div');
    headerRow.className = 'grid-header-row';

    const corner = document.createElement('div');
    corner.className = 'grid-corner';
    headerRow.appendChild(corner);

    for (let c = 0; c < COLS; c++) {
      const h = document.createElement('div');
      h.className = 'grid-col-title';
      h.dataset.col = String(c);
      h.textContent = colToLetters(c);
      headerRow.appendChild(h);
    }
    this.body.appendChild(headerRow);

    // 数据行
    for (let r = 0; r < ROWS; r++) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'grid-row';

      const rowTitle = document.createElement('div');
      rowTitle.className = 'grid-row-title';
      rowTitle.dataset.row = String(r);
      rowTitle.textContent = String(r + 1);
      rowDiv.appendChild(rowTitle);

      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        rowDiv.appendChild(cell);
      }
      this.body.appendChild(rowDiv);
    }

    // 尺寸
    this.body.style.width = `${HEADER_W + COLS * COL_W}px`;
    this.body.style.height = `${HEADER_H + ROWS * ROW_H}px`;
  }

  private cellEl(row: number, col: number): HTMLDivElement {
    return this.body.querySelector(
      `.grid-cell[data-row="${row}"][data-col="${col}"]`,
    ) as HTMLDivElement;
  }

  private bindEvents(): void {
    this.body.addEventListener('mousedown', (e) => {
      if (this.editing) return;
      const target = e.target as HTMLElement;

      const colTitle = target.closest('.grid-col-title') as HTMLElement | null;
      if (colTitle) {
        const col = Number(colTitle.dataset.col);
        this.startDrag({ row: 0, col }, { row: ROWS - 1, col }, e);
        return;
      }
      const rowTitle = target.closest('.grid-row-title') as HTMLElement | null;
      if (rowTitle) {
        const row = Number(rowTitle.dataset.row);
        this.startDrag({ row, col: 0 }, { row, col: COLS - 1 }, e);
        return;
      }
      const cell = target.closest('.grid-cell') as HTMLElement | null;
      if (cell) {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        this.startDrag({ row, col }, { row, col }, e);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.dragSelecting) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest?.('.grid-cell') as HTMLElement | null;
      if (!cell) return;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const { selection } = state;
      selection.anchor = { row, col };
      if (!e.ctrlKey && !e.metaKey) {
        selection.ranges = [normalizeRange(selection.active, { row, col })];
      }
      this.renderOverlay();
    });

    document.addEventListener('mouseup', () => {
      this.dragSelecting = false;
    });

    this.body.addEventListener('dblclick', (e) => {
      const cell = (e.target as HTMLElement).closest('.grid-cell') as HTMLElement | null;
      if (cell) this.beginEdit(Number(cell.dataset.row), Number(cell.dataset.col));
    });

    this.body.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.body.tabIndex = 0;

    this.editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelEdit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.commitEdit();
        this.moveActive(0, e.shiftKey ? -1 : 1);
      }
      e.stopPropagation();
    });
  }

  private startDrag(a: CellPoint, b: CellPoint, e: MouseEvent): void {
    const { selection } = state;
    if (e.ctrlKey || e.metaKey) {
      selection.ranges.push(normalizeRange(a, b));
    } else {
      selection.active = a;
      selection.anchor = b;
      selection.ranges = [normalizeRange(a, b)];
    }
    this.dragSelecting = true;
    this.body.focus();
    this.cb.onActiveChange(a.row, a.col);
    this.renderOverlay();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.editing) return;
    const { selection } = state;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        this.moveActive(-1, 0);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.moveActive(1, 0);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.moveActive(0, -1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.moveActive(0, 1);
        break;
      case 'Enter':
        e.preventDefault();
        this.beginEdit(selection.active.row, selection.active.col);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSelection();
        break;
      default:
        if (e.key.length === 1 || e.key === '=' || e.key === 'F2') {
          if (e.key === 'F2') {
            e.preventDefault();
            this.beginEdit(selection.active.row, selection.active.col);
          } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            this.beginEdit(selection.active.row, selection.active.col, e.key);
          }
        }
    }
  }

  private moveActive(dRow: number, dCol: number): void {
    const { selection } = state;
    const row = Math.max(0, Math.min(ROWS - 1, selection.active.row + dRow));
    const col = Math.max(0, Math.min(COLS - 1, selection.active.col + dCol));
    selection.active = { row, col };
    selection.anchor = { row, col };
    selection.ranges = [normalizeRange({ row, col }, { row, col })];
    this.cb.onActiveChange(row, col);
    this.renderOverlay();
    this.scrollIntoView(row, col);
  }

  private scrollIntoView(row: number, col: number): void {
    const el = this.cellEl(row, col);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private deleteSelection(): void {
    for (const r of state.selection.ranges) {
      for (let row = r.top; row <= r.bottom; row++) {
        for (let col = r.left; col <= r.right; col++) {
          this.cb.onEdit(row, col, '');
        }
      }
    }
  }

  beginEdit(row: number, col: number, initial?: string): void {
    this.editing = { row, col };
    this.editor.style.display = 'block';
    this.editor.style.left = `${HEADER_W + col * COL_W}px`;
    this.editor.style.top = `${HEADER_H + row * ROW_H}px`;
    this.editor.style.width = `${COL_W}px`;
    this.editor.style.height = `${ROW_H}px`;
    const snapshot = state.snapshot;
    const addr = formatAddr({ row, col });
    const existing = snapshot?.cells[addr]?.raw ?? '';
    this.editor.value = initial !== undefined ? initial : existing;
    this.editor.focus();
    this.editor.setSelectionRange(this.editor.value.length, this.editor.value.length);
  }

  private commitEdit(): void {
    if (!this.editing) return;
    const { row, col } = this.editing;
    const raw = this.editor.value;
    this.editing = null;
    this.editor.style.display = 'none';
    this.cb.onEdit(row, col, raw);
    this.body.focus();
  }

  private cancelEdit(): void {
    this.editing = null;
    this.editor.style.display = 'none';
    this.body.focus();
  }

  /** 快照到达后刷新所有单元格显示 */
  renderValues(): void {
    const snapshot = state.snapshot;
    const cells = this.body.querySelectorAll<HTMLElement>('.grid-cell');
    cells.forEach((cell) => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const addr = formatAddr({ row, col });
      const computed = snapshot?.cells[addr];
      cell.textContent = computed ? formatValue(computed.value) : '';
      cell.className = 'grid-cell';
      if (computed) cell.classList.add(valueClass(computed.value));
    });
    this.renderOverlay();
  }

  /** 根据选区/图联动重绘高亮（不重写文本，开销小） */
  renderOverlay(): void {
    const cells = this.body.querySelectorAll<HTMLElement>('.grid-cell');
    const { selection, graphHighlight } = state;
    const activeAddr = formatAddr(selection.active);

    // 选中活动格 => 计算其全部上游/下游（特性 29）；再叠加图交互
    const { upstream, downstream } = computeCellHighlight(activeAddr);
    const graphActive = graphHighlight?.active ?? null;

    cells.forEach((cell) => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const addr = formatAddr({ row, col });
      const point = { row, col };

      cell.classList.toggle('selected', selection.ranges.some((r) => pointInRange(point, r)));
      cell.classList.toggle('active-cell', addr === activeAddr);
      cell.classList.toggle('upstream-cell', upstream.has(addr));
      cell.classList.toggle('downstream-cell', downstream.has(addr));
      cell.classList.toggle(
        'graph-active-cell',
        graphActive !== null && addr === graphActive,
      );
    });

    // 标题头联动
    this.body.querySelectorAll<HTMLElement>('.grid-col-title').forEach((h) => {
      h.classList.toggle('title-active', Number(h.dataset.col) === selection.active.col);
    });
    this.body.querySelectorAll<HTMLElement>('.grid-row-title').forEach((h) => {
      h.classList.toggle('title-active', Number(h.dataset.row) === selection.active.row);
    });
  }

  focus(): void {
    this.body.focus();
  }

  get activePoint(): CellPoint {
    return state.selection.active;
  }
}
