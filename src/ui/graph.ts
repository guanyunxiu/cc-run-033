/**
 * 依赖图 SVG 视图（特性 27、28、29、30；技术点 21 SVG、22 分层布局）。
 *
 * 布局策略（基础分层布局）：
 *  - 压缩单元格级依赖图，计算最长依赖深度作为层级 x；
 *  - 同层单元格按行、列排序分配 y；
 *  - formula 节点绘制在 owner cell 左侧小偏移处；
 *  - range 节点绘制在 owner 与成员区域之间。
 *
 * 交互：滚轮缩放、拖拽平移、悬停提示、点击选中并与网格联动。
 */
import type {
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  Snapshot,
} from '../engine/protocol';
import { cellKey, UiState } from './state';

interface Positioned {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  node: GraphNodeSnapshot;
}

const CELL_W = 64;
const CELL_H = 24;
const FORMULA_W = 52;
const FORMULA_H = 20;
const RANGE_W = 68;
const RANGE_H = 18;
const LAYER_GAP_X = 150;
const ROW_GAP_Y = 38;
const MARGIN = 80;

export interface GraphCallbacks {
  onSelectCell(col: number, row: number): void;
  onHoverNode(id: string | null): void;
  getState(): UiState;
}

export class GraphView {
  private svg!: SVGSVGElement;
  private gRoot!: SVGGElement;
  private edgeLayer!: SVGGElement;
  private nodeLayer!: SVGGElement;
  private tooltip: HTMLDivElement;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private positions = new Map<string, Positioned>();
  private positioned: Positioned[] = [];
  private edges: GraphEdgeSnapshot[] = [];
  private snapshot: Snapshot | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: GraphCallbacks,
  ) {
    this.buildDom();
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'graph-tooltip';
    this.tooltip.style.display = 'none';
    this.root.appendChild(this.tooltip);
  }

  private buildDom(): void {
    this.root.classList.add('graph-wrap');
    const toolbar = document.createElement('div');
    toolbar.className = 'graph-toolbar';
    toolbar.innerHTML = `
      <button data-act="zoom-in">＋</button>
      <button data-act="zoom-out">－</button>
      <button data-act="reset">重置视图</button>
      <label><input type="checkbox" data-act="ranges" /> 显示区域节点</label>
    `;
    this.root.appendChild(toolbar);

    toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'zoom-in') this.setScale(this.scale * 1.2);
      if (btn.dataset.act === 'zoom-out') this.setScale(this.scale / 1.2);
      if (btn.dataset.act === 'reset') this.resetView();
    });
    toolbar.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.act === 'ranges') {
        this.cb.getState().showRanges = input.checked;
        this.update(this.cb.getState());
      }
    });

    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = `
      <span class="lg-cell">单元格</span>
      <span class="lg-formula">公式</span>
      <span class="lg-range">区域</span>
      <span class="lg-up">上游</span>
      <span class="lg-down">下游</span>
    `;
    this.root.appendChild(legend);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('graph-svg');
    this.svg = svg;

    const gRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gRoot = gRoot;
    this.edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gRoot.appendChild(this.edgeLayer);
    gRoot.appendChild(this.nodeLayer);
    svg.appendChild(gRoot);
    this.root.appendChild(svg);

    // 滚轮缩放（以指针为中心）
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoomAt(factor, e.offsetX, e.offsetY);
    }, { passive: false });

    // 拖拽平移
    let panning = false;
    let sx = 0;
    let sy = 0;
    let moved = false;
    svg.addEventListener('mousedown', (e) => {
      if ((e.target as Element).closest('.node')) return;
      panning = true;
      moved = false;
      sx = e.clientX - this.tx;
      sy = e.clientY - this.ty;
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      moved = true;
      this.tx = e.clientX - sx;
      this.ty = e.clientY - sy;
      this.applyTransform();
    });
    window.addEventListener('mouseup', () => {
      panning = false;
    });
    svg.addEventListener('click', (e) => {
      if (moved) return;
      if (!(e.target as Element).closest('.node')) {
        this.cb.onHoverNode(null);
      }
    });
  }

  private setScale(s: number): void {
    this.scale = Math.min(3, Math.max(0.2, s));
    this.applyTransform();
  }

  private zoomAt(factor: number, px: number, py: number): void {
    const next = Math.min(3, Math.max(0.2, this.scale * factor));
    const real = next / this.scale;
    this.tx = px - (px - this.tx) * real;
    this.ty = py - (py - this.ty) * real;
    this.scale = next;
    this.applyTransform();
  }

  private resetView(): void {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.gRoot.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
  }

  /* ---------------- 分层布局 ---------------- */
  private layout(snapshot: Snapshot, showRanges: boolean): void {
    this.positions.clear();
    this.positioned = [];

    // 1. 只保留有公式参与的 cell 链：找出所有 formula 节点及其上下游 cell
    const formulaOwners = new Set<string>();
    for (const n of snapshot.nodes) if (n.kind === 'formula' && n.owner) formulaOwners.add(n.owner);

    const involvedCells = new Set<string>();
    const outAdj = new Map<string, Set<string>>();
    const inAdj = new Map<string, Set<string>>();
    const addAdj = (m: Map<string, Set<string>>, a: string, b: string): void => {
      let s = m.get(a);
      if (!s) {
        s = new Set();
        m.set(a, s);
      }
      s.add(b);
    };
    for (const e of snapshot.edges) {
      addAdj(outAdj, e.from, e.to);
      addAdj(inAdj, e.to, e.from);
    }

    // 压缩 formula/range -> cell 依赖
    const cellOut = new Map<string, Set<string>>();
    const ensure = (m: Map<string, Set<string>>, k: string): Set<string> => {
      let s = m.get(k);
      if (!s) {
        s = new Set();
        m.set(k, s);
      }
      return s;
    };
    const reachable = (start: string): string[] => {
      const seen = new Set<string>([start]);
      const q = [start];
      while (q.length) {
        const cur = q.shift()!;
        for (const n of outAdj.get(cur) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            q.push(n);
          }
        }
      }
      return [...seen];
    };

    for (const owner of formulaOwners) {
      involvedCells.add(owner);
      const fId = `formula:${owner}`;
      for (const id of reachable(fId)) {
        const node = snapshot.nodes.find((n) => n.id === id);
        if (node?.kind === 'cell') involvedCells.add(node.label);
      }
    }
    // 字面量/错误单元格若被引用，也在上面循环里加入了
    for (const owner of formulaOwners) {
      const ownerCellId = `cell:${owner}`;
      ensure(cellOut, ownerCellId);
      for (const id of reachable(`formula:${owner}`)) {
        const node = snapshot.nodes.find((n) => n.id === id);
        if (node?.kind === 'cell' && node.label !== owner) {
          ensure(cellOut, ownerCellId).add(`cell:${node.label}`);
          ensure(cellOut, `cell:${node.label}`);
        }
      }
    }

    // 2. 最长依赖深度（叶子=0）
    const depth = new Map<string, number>();
    const visiting = new Set<string>();
    const calcDepth = (id: string): number => {
      const cached = depth.get(id);
      if (cached !== undefined) return cached;
      if (visiting.has(id)) return 0; // 环上回边
      visiting.add(id);
      let d = 0;
      for (const dep of cellOut.get(id) ?? []) {
        d = Math.max(d, calcDepth(dep) + 1);
      }
      visiting.delete(id);
      depth.set(id, d);
      return d;
    };
    for (const id of cellOut.keys()) calcDepth(id);

    // 3. 按层放置 cell；同层按 (row,col)
    const cellNodes = [...involvedCells]
      .map((key) => snapshot.nodes.find((n) => n.id === `cell:${key}`))
      .filter((n): n is GraphNodeSnapshot => !!n);

    const byLayer = new Map<number, GraphNodeSnapshot[]>();
    for (const n of cellNodes) {
      const d = depth.get(n.id) ?? 0;
      const arr = byLayer.get(d) ?? [];
      arr.push(n);
      byLayer.set(d, arr);
    }

    for (const [d, arr] of byLayer) {
      arr.sort((a, b) => a.row - b.row || a.col - b.col);
      arr.forEach((node, i) => {
        const p: Positioned = {
          id: node.id,
          x: MARGIN + d * LAYER_GAP_X,
          y: MARGIN + i * ROW_GAP_Y,
          w: CELL_W,
          h: CELL_H,
          node,
        };
        this.positions.set(p.id, p);
        this.positioned.push(p);
      });
    }

    // formula 节点：放在 owner cell 右侧 + 上方偏移
    for (const n of snapshot.nodes) {
      if (n.kind !== 'formula' || !n.owner) continue;
      const ownerPos = this.positions.get(`cell:${n.owner}`);
      if (!ownerPos) continue;
      const p: Positioned = {
        id: n.id,
        x: ownerPos.x + 6,
        y: ownerPos.y - FORMULA_H - 6,
        w: FORMULA_W,
        h: FORMULA_H,
        node: n,
      };
      this.positions.set(p.id, p);
      this.positioned.push(p);
    }

    // range 节点：放在 owner formula 下方
    if (showRanges) {
      for (const n of snapshot.nodes) {
        if (n.kind !== 'range' || !n.owner) continue;
        const ownerPos = this.positions.get(`formula:${n.owner}`);
        if (!ownerPos) continue;
        const p: Positioned = {
          id: n.id,
          x: ownerPos.x - 8,
          y: ownerPos.y + FORMULA_H + 8,
          w: RANGE_W,
          h: RANGE_H,
          node: n,
        };
        this.positions.set(p.id, p);
        this.positioned.push(p);
      }
    }
  }

  /* ---------------- 渲染 ---------------- */
  update(state: UiState): void {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    this.snapshot = snapshot;
    this.layout(snapshot, state.showRanges);

    const visibleIds = new Set(this.positioned.map((p) => p.id));
    this.edges = snapshot.edges.filter(
      (e) => visibleIds.has(e.from) && visibleIds.has(e.to),
    );

    // 高亮集合
    const focusNodeId = state.hoverNode ?? state.selectedGraphNode ?? null;
    let focusCellKey: string | null = null;
    if (!focusNodeId) {
      focusCellKey = cellKey(state.active.col, state.active.row);
    } else if (focusNodeId.startsWith('cell:')) {
      focusCellKey = focusNodeId.slice('cell:'.length);
    } else {
      const node = snapshot.nodes.find((n) => n.id === focusNodeId);
      focusCellKey = node?.owner ?? null;
    }

    const { up, down } = this.computeHighlight(snapshot, focusNodeId, focusCellKey);

    // 边
    this.edgeLayer.innerHTML = '';
    for (const e of this.edges) {
      const a = this.positions.get(e.from)!;
      const b = this.positions.get(e.to)!;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', this.edgePath(a, b));
      path.classList.add('edge', e.reason);
      const related =
        !!focusNodeId && (e.from === focusNodeId || e.to === focusNodeId);
      if (related) path.classList.add('highlight');
      if (focusNodeId && !related && !up.has(e.to) && !down.has(e.from) && !up.has(e.from) && !down.has(e.to)) {
        path.classList.add('dim');
      }
      path.dataset.from = e.from;
      path.dataset.to = e.to;
      this.edgeLayer.appendChild(path);
    }

    // 节点
    this.nodeLayer.innerHTML = '';
    for (const p of this.positioned) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.classList.add('node', p.node.kind);
      g.setAttribute('transform', `translate(${p.x},${p.y})`);
      g.dataset.id = p.id;

      const cell =
        p.node.kind === 'cell' ? snapshot.cells[p.node.label] : undefined;
      if (cell?.valueType === 'error') g.classList.add(cell.errorCode === '#CYCLE!' ? 'cycle' : 'error');

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', String(p.w));
      rect.setAttribute('height', String(p.h));
      rect.setAttribute('rx', p.node.kind === 'cell' ? '3' : '8');
      g.appendChild(rect);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(p.w / 2));
      text.setAttribute('y', String(p.h / 2 + 1));
      text.textContent =
        p.node.kind === 'formula' ? `ƒ ${p.node.owner}` : p.node.label;
      g.appendChild(text);

      if (focusNodeId === p.id) g.classList.add('selected');
      if (up.has(p.id)) g.classList.add('upstream');
      if (down.has(p.id)) g.classList.add('downstream');
      if (focusNodeId && focusNodeId !== p.id && !up.has(p.id) && !down.has(p.id)) {
        g.classList.add('dim');
      }

      g.addEventListener('mouseenter', (ev) => {
        this.cb.onHoverNode(p.id);
        this.showTooltip(ev, p.node, cell?.formulaText ?? null);
      });
      g.addEventListener('mousemove', (ev) => this.moveTooltip(ev));
      g.addEventListener('mouseleave', () => {
        this.cb.onHoverNode(null);
        this.hideTooltip();
      });
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (p.node.kind === 'cell') {
          this.cb.onSelectCell(p.node.col, p.node.row);
        } else if (p.node.owner) {
          const ownerCell = snapshot.nodes.find(
            (n) => n.id === `cell:${p.node.owner}`,
          );
          if (ownerCell) this.cb.onSelectCell(ownerCell.col, ownerCell.row);
        }
      });

      this.nodeLayer.appendChild(g);
    }
  }

  private edgePath(a: Positioned, b: Positioned): string {
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h / 2;
    const x2 = b.x + b.w / 2;
    const y2 = b.y + b.h / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }

  /**
   * 上游/下游高亮（特性 29）。
   * 焦点在图上时按完整图 BFS；焦点在网格上时同时高亮 owner 链与引用链。
   */
  private computeHighlight(
    snapshot: Snapshot,
    focusNodeId: string | null,
    focusCellKey: string | null,
  ): { up: Set<string>; down: Set<string> } {
    const out = new Map<string, string[]>();
    const inc = new Map<string, string[]>();
    for (const e of snapshot.edges) {
      out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
      inc.set(e.to, [...(inc.get(e.to) ?? []), e.from]);
    }
    const bfs = (start: string, adj: Map<string, string[]>): Set<string> => {
      const seen = new Set<string>();
      const q = [start];
      const pushed = new Set([start]);
      while (q.length) {
        const cur = q.shift()!;
        for (const n of adj.get(cur) ?? []) {
          if (pushed.has(n)) continue;
          pushed.add(n);
          seen.add(n);
          q.push(n);
        }
      }
      return seen;
    };

    const up = new Set<string>();
    const down = new Set<string>();
    if (focusNodeId) {
      for (const x of bfs(focusNodeId, out)) up.add(x);
      for (const x of bfs(focusNodeId, inc)) down.add(x);
    } else if (focusCellKey) {
      // 网格焦点：cell 与 formula 都视为焦点
      const cid = `cell:${focusCellKey}`;
      const fid = `formula:${focusCellKey}`;
      for (const x of bfs(cid, out)) up.add(x);
      if (snapshot.nodes.some((n) => n.id === fid)) {
        for (const x of bfs(fid, out)) up.add(x);
      }
      for (const x of bfs(cid, inc)) down.add(x);
    }
    return { up, down };
  }

  private showTooltip(ev: MouseEvent, node: GraphNodeSnapshot, formula: string | null): void {
    const kindName = node.kind === 'cell' ? '单元格' : node.kind === 'formula' ? '公式' : '区域';
    this.tooltip.innerHTML = '';
    const lines = [
      `<strong>${node.label}</strong> <${kindName}>`,
      formula ? `公式: ${formula}` : '',
      node.kind === 'range' ? '区域引用节点（覆盖多个单元格）' : '',
    ].filter(Boolean);
    this.tooltip.innerHTML = lines.join('<br/>');
    this.tooltip.style.display = 'block';
    this.moveTooltip(ev);
  }

  private moveTooltip(ev: MouseEvent): void {
    const rect = this.root.getBoundingClientRect();
    this.tooltip.style.left = `${ev.clientX - rect.left + 12}px`;
    this.tooltip.style.top = `${ev.clientY - rect.top + 12}px`;
  }

  private hideTooltip(): void {
    this.tooltip.style.display = 'none';
  }

  /** 居中显示某个 cell 节点（网格点击图联动时使用）。 */
  focusCell(col: number, row: number): void {
    const id = `cell:${cellKey(col, row)}`;
    const p = this.positions.get(id);
    if (!p) return;
    const rect = this.svg.getBoundingClientRect();
    this.scale = Math.max(this.scale, 0.9);
    this.tx = rect.width / 2 - (p.x + p.w / 2) * this.scale;
    this.ty = rect.height / 2 - (p.y + p.h / 2) * this.scale;
    this.applyTransform();
  }
}
