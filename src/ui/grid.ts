/**
 * 网格组件：单元格网格 + 行列标题 + 选区/多选/框选 + 内联编辑。
 * 与公式栏、依赖图联动。
 */
import { columnName } from '../engine/a1';
import type { CellSnapshot, Snapshot } from '../engine/protocol';
import { cellKey, RangeSelection, Selection, UiState } from './state';

export const GRID_ROWS = 40;
export const GRID_COLS = 12; // A..L

export interface GridCallbacks {
  onSelectionChange(active: Selection, box: RangeSelection | null, multi: Set<string>): void;
  onEditCommit(col: number, row: number, raw: string): void;
  onEditStart(): void;
  onEditEnd(): void;
  getState(): UiState;
}

export class GridView {
  private table!: HTMLTableElement;
  private inputCell: { col: number; row: number; input: HTMLInputElement } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: GridCallbacks,
  ) {
    this.renderShell();
  }

  /* ---------------- 骨架（表头） ---------------- */
  private renderShell(): void {
    const table = document.createElement('table');
    table.className = 'grid';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'corner';
    corner.textContent = '';
    headRow.appendChild(corner);
    for (let c = 0; c < GRID_COLS; c++) {
      const th = document.createElement('th');
      th.dataset.col = String(c);
      th.textContent = columnName(c);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < GRID_ROWS; r++) {
      const tr = document.createElement('tr');
      const rowHead = document.createElement('th');
      rowHead.className = 'row-head';
      rowHead.dataset.row = String(r);
      rowHead.textContent = String(r + 1);
      tr.appendChild(rowHead);
      for (let c = 0; c < GRID_COLS; c++) {
        const td = document.createElement('td');
        td.dataset.col = String(c);
        td.dataset.row = String(r);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.table = table;
    this.root.appendChild(table);

    let dragAnchor: Selection | null = null;
    let dragging = false;

    tbody.addEventListener('mousedown', (e) => {
      const td = (e.target as HTMLElement).closest('td') as HTMLTableCellElement | null;
      if (!td) return;
      const col = Number(td.dataset.col);
      const row = Number(td.dataset.row);
      e.preventDefault();

      if (this.inputCell) this.commitInlineEdit();

      const state = this.cb.getState();
      if (e.ctrlKey || e.metaKey) {
        const multi = new Set(state.multi);
        const key = cellKey(col, row);
        if (multi.has(key)) multi.delete(key);
        else multi.add(key);
        this.cb.onSelectionChange({ col, row }, state.box, multi);
        return;
      }

      if (e.shiftKey) {
        // Shift+点击：从当前活动单元格扩展框选
        const a = state.active;
        this.cb.onSelectionChange(
          a,
          {
            c0: Math.min(a.col, col),
            r0: Math.min(a.row, row),
            c1: Math.max(a.col, col),
            r1: Math.max(a.row, row),
          },
          new Set(),
        );
        return;
      }

      dragAnchor = { col, row };
      dragging = true;
      this.cb.onSelectionChange({ col, row }, { c0: col, r0: row, c1: col, r1: row }, new Set());
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging || !dragAnchor) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el?.closest('td') as HTMLTableCellElement | null;
      if (!td || !td.dataset.col) return;
      const col = Number(td.dataset.col);
      const row = Number(td.dataset.row);
      this.cb.onSelectionChange(
        { col: dragAnchor.col, row: dragAnchor.row },
        {
          c0: Math.min(dragAnchor.col, col),
          r0: Math.min(dragAnchor.row, row),
          c1: Math.max(dragAnchor.col, col),
          r1: Math.max(dragAnchor.row, row),
        },
        new Set(),
      );
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
      dragAnchor = null;
    });

    tbody.addEventListener('dblclick', (e) => {
      const td = (e.target as HTMLElement).closest('td') as HTMLTableCellElement | null;
      if (!td) return;
      this.startEdit(Number(td.dataset.col), Number(td.dataset.row));
    });
  }

  /* ---------------- 数据刷新 ---------------- */
  update(snapshot: Snapshot, state: UiState): void {
    const tds = this.table.querySelectorAll<HTMLTableCellElement>('tbody td');
    const upstream = new Set<string>();
    const downstream = this.computeDownstreamCells(snapshot, state);

    const deps = state.active
      ? snapshot.formulaDeps[cellKey(state.active.col, state.active.row)]
      : undefined;
    if (deps) {
      for (const c of deps.cells) upstream.add(cellKey(c.col, c.row));
      // 区域的成员也标记上游（snapshot.nodes 里查 covers 边）
      for (const edge of snapshot.edges) {
        if (
          edge.from.startsWith('range:') &&
          edge.from.includes(`${cellKey(state.active.col, state.active.row)}|`) &&
          edge.reason === 'covers' &&
          edge.to.startsWith('cell:')
        ) {
          upstream.add(edge.to.slice('cell:'.length));
        }
      }
    }

    const box = state.box;
    const inBox = (c: number, r: number): boolean =>
      !!box && c >= box.c0 && c <= box.c1 && r >= box.r0 && r <= box.r1;

    tds.forEach((td) => {
      const col = Number(td.dataset.col);
      const row = Number(td.dataset.row);
      const key = cellKey(col, row);
      const cell = snapshot.cells[key];

      // 正在编辑的单元格不覆盖其 input
      if (this.inputCell && this.inputCell.col === col && this.inputCell.row === row) {
        this.applySelectionClasses(td, col, row, state, inBox, upstream, downstream, key);
        return;
      }

      td.textContent = cell?.display ?? '';
      td.className = '';
      if (cell) {
        if (cell.valueType === 'error') {
          td.classList.add(cell.errorCode === '#CYCLE!' ? 'cell-cycle' : 'cell-error');
        } else {
          td.classList.add(`cell-${cell.valueType}`);
        }
        if (cell.formulaText) {
          const mark = document.createElement('span');
          mark.className = 'corner-mark';
          td.title = `${key}  ${cell.formulaText}`;
          td.appendChild(mark);
        } else {
          td.title = `${key}  ${cell.display}`;
        }
      } else {
        td.title = key;
      }

      this.applySelectionClasses(td, col, row, state, inBox, upstream, downstream, key);
    });

    // 行列表头高亮：列标题在当前列或框选列范围内时高亮
    this.table
      .querySelectorAll<HTMLTableCellElement>('thead th[data-col]')
      .forEach((th) => {
        const c = Number(th.dataset.col);
        const active =
          c === state.active.col || (!!box && c >= box.c0 && c <= box.c1);
        th.classList.toggle('active-head', active);
      });
    this.table
      .querySelectorAll<HTMLTableCellElement>('tbody th.row-head')
      .forEach((th) => {
        const r = Number(th.dataset.row);
        const active =
          r === state.active.row || (!!box && r >= box.r0 && r <= box.r1);
        th.classList.toggle('active-head', active);
      });
  }

  private applySelectionClasses(
    td: HTMLTableCellElement,
    col: number,
    row: number,
    state: UiState,
    inBox: (c: number, r: number) => boolean,
    upstream: Set<string>,
    downstream: Set<string>,
    key: string,
  ): void {
    td.classList.toggle('selected', col === state.active.col && row === state.active.row);
    td.classList.toggle('multi-selected', state.multi.has(key));
    td.classList.toggle('range-selected', inBox(col, row) && !(col === state.active.col && row === state.active.row));
    td.classList.toggle('upstream', upstream.has(key));
    td.classList.toggle('downstream', downstream.has(key));
  }

  /** 下游高亮：当前活动单元格被哪些公式（传递）引用。 */
  private computeDownstreamCells(snapshot: Snapshot, state: UiState): Set<string> {
    const result = new Set<string>();
    if (!snapshot) return result;
    // 在完整图（cell/formula/range）上从活动 cell 做逆邻接 BFS
    const incoming = new Map<string, Set<string>>();
    for (const e of snapshot.edges) {
      let s = incoming.get(e.to);
      if (!s) {
        s = new Set();
        incoming.set(e.to, s);
      }
      s.add(e.from);
    }
    const start = `cell:${cellKey(state.active.col, state.active.row)}`;
    const queue = [start];
    const seen = new Set<string>([start]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nxt of incoming.get(cur) ?? []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        queue.push(nxt);
        const node = snapshot.nodes.find((n) => n.id === nxt);
        if (node?.kind === 'cell') result.add(node.label);
      }
    }
    return result;
  }

  /* ---------------- 内联编辑 ---------------- */
  startEdit(col: number, row: number, initial?: string): void {
    if (this.inputCell) this.commitInlineEdit();
    const td = this.table.querySelector<HTMLTableCellElement>(
      `td[data-col="${col}"][data-row="${row}"]`,
    );
    if (!td) return;
    td.textContent = '';
    td.classList.add('editing');
    const input = document.createElement('input');
    input.value = initial ?? this.cb.getState().snapshot?.cells[cellKey(col, row)]?.raw ?? '';
    td.appendChild(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    this.inputCell = { col, row, input };
    this.cb.onEditStart();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitInlineEdit();
        this.cb.onSelectionChange(
          { col, row: Math.min(row + 1, GRID_ROWS - 1) },
          null,
          new Set(),
        );
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelInlineEdit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.commitInlineEdit();
        this.cb.onSelectionChange(
          { col: Math.min(col + 1, GRID_COLS - 1), row },
          null,
          new Set(),
        );
      }
      e.stopPropagation();
    });
  }

  commitInlineEdit(): void {
    if (!this.inputCell) return;
    const { col, row, input } = this.inputCell;
    const raw = input.value;
    this.inputCell = null;
    this.cb.onEditCommit(col, row, raw);
    this.cb.onEditEnd();
  }

  cancelInlineEdit(): void {
    this.inputCell = null;
    this.cb.onEditEnd();
  }

  isEditing(): boolean {
    return this.inputCell !== null;
  }

  scrollToActive(state: UiState): void {
    const td = this.table.querySelector<HTMLTableCellElement>(
      `td[data-col="${state.active.col}"][data-row="${state.active.row}"]`,
    );
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

export function cellSnapshotLabel(cell: CellSnapshot | undefined): string {
  if (!cell) return '空';
  return cell.display || '(空)';
}
