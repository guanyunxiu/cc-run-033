/**
 * 依赖图 SVG 可视化（特性 27、28、29、30）。
 *
 * - 纯 SVG 渲染 cell / formula / range 三类节点
 * - 滚轮缩放、拖拽平移
 * - 悬停/点击节点：高亮全部上游（depends）与下游（depended-by）
 * - 与网格联动（高亮地址通过回调上抛给 App）
 */
import type { GraphSnapshot, SerializedNode } from '../core/types.js';
import { state } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_W = 96;
const NODE_H = 34;

export interface GraphCallbacks {
  onNodeSelect(addr: string | null): void;
  onHighlight(upstream: Set<string>, downstream: Set<string>, active: string | null): void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export class GraphView {
  readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly edgeLayer: SVGGElement;
  private readonly nodeLayer: SVGGElement;
  private readonly defs: SVGDefsElement;
  private transform: Transform = { x: 0, y: 0, scale: 1 };
  private snapshot: GraphSnapshot | null = null;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private panning = false;
  private panStart: { x: number; y: number; tx: number; ty: number } | null = null;

  constructor(private readonly cb: GraphCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'graph-root';

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('graph-svg');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    this.defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', 'arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto-start-reverse');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    path.setAttribute('fill', '#94a3b8');
    marker.appendChild(path);
    this.defs.appendChild(marker);
    this.svg.appendChild(this.defs);

    const rootG = document.createElementNS(SVG_NS, 'g');
    rootG.classList.add('graph-transform');
    this.edgeLayer = document.createElementNS(SVG_NS, 'g');
    this.edgeLayer.classList.add('edge-layer');
    this.nodeLayer = document.createElementNS(SVG_NS, 'g');
    this.nodeLayer.classList.add('node-layer');
    rootG.append(this.edgeLayer, this.nodeLayer);
    this.svg.appendChild(rootG);
    this.root.appendChild(this.svg);

    this.addZoomControls();
    this.bindInteractions();
  }

  private addZoomControls(): void {
    const bar = document.createElement('div');
    bar.className = 'graph-controls';
    const zoomIn = document.createElement('button');
    zoomIn.textContent = '+';
    zoomIn.title = '放大';
    const zoomOut = document.createElement('button');
    zoomOut.textContent = '−';
    zoomOut.title = '缩小';
    const fit = document.createElement('button');
    fit.textContent = '适应';
    fit.title = '适应画布';
    zoomIn.addEventListener('click', () => this.zoomAt(1.2));
    zoomOut.addEventListener('click', () => this.zoomAt(1 / 1.2));
    fit.addEventListener('click', () => this.fit());
    bar.append(zoomOut, zoomIn, fit);
    this.root.appendChild(bar);
  }

  private bindInteractions(): void {
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.zoomAt(factor, e.offsetX, e.offsetY);
    }, { passive: false });

    this.svg.addEventListener('mousedown', (e) => {
      if ((e.target as Element).closest('.graph-node')) return;
      this.panning = true;
      this.panStart = { x: e.clientX, y: e.clientY, tx: this.transform.x, ty: this.transform.y };
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.panning || !this.panStart) return;
      this.transform.x = this.panStart.tx + (e.clientX - this.panStart.x);
      this.transform.y = this.panStart.ty + (e.clientY - this.panStart.y);
      this.applyTransform();
    });
    window.addEventListener('mouseup', () => {
      this.panning = false;
      this.panStart = null;
    });

    this.nodeLayer.addEventListener('mouseover', (e) => {
      const nodeEl = (e.target as Element).closest('.graph-node') as SVGGElement | null;
      if (!nodeEl) return;
      this.hoverId = nodeEl.dataset.id!;
      this.applyHighlight();
    });
    this.nodeLayer.addEventListener('mouseout', () => {
      this.hoverId = null;
      this.applyHighlight();
    });
    this.nodeLayer.addEventListener('click', (e) => {
      const nodeEl = (e.target as Element).closest('.graph-node') as SVGGElement | null;
      if (!nodeEl) {
        this.selectedId = null;
        this.cb.onNodeSelect(null);
        this.applyHighlight();
        return;
      }
      this.selectedId = this.selectedId === nodeEl.dataset.id ? null : nodeEl.dataset.id!;
      const node = this.snapshot?.nodes.find((n) => n.id === this.selectedId);
      this.cb.onNodeSelect(node ? this.nodeAddress(node) : null);
      this.applyHighlight();
    });
  }

  /** 从图节点取它关联的单元格地址（cell 本身 / formula、range 的 owner） */
  private nodeAddress(node: SerializedNode): string {
    if (node.kind === 'cell') return node.label;
    const owner = node.id.startsWith('formula@')
      ? node.id.slice('formula@'.length)
      : null;
    return owner ?? node.label;
  }

  private zoomAt(factor: number, cx?: number, cy?: number): void {
    const rect = this.svg.getBoundingClientRect();
    const px = cx ?? rect.width / 2;
    const py = cy ?? rect.height / 2;
    const next = Math.min(3, Math.max(0.2, this.transform.scale * factor));
    const k = next / this.transform.scale;
    this.transform.x = px - (px - this.transform.x) * k;
    this.transform.y = py - (py - this.transform.y) * k;
    this.transform.scale = next;
    this.applyTransform();
  }

  fit(): void {
    if (!this.snapshot || this.snapshot.nodes.length === 0) return;
    const xs = this.snapshot.nodes.map((n) => n.x);
    const ys = this.snapshot.nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 40;
    const minY = Math.min(...ys) - 40;
    const width = Math.max(...xs) - minX + NODE_W + 80;
    const height = Math.max(...ys) - minY + NODE_H + 80;
    const rect = this.svg.getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height, 1.2);
    this.transform = {
      scale,
      x: (rect.width - width * scale) / 2 - minX * scale,
      y: 20 - minY * scale,
    };
    this.applyTransform();
  }

  private applyTransform(): void {
    const g = this.svg.querySelector('.graph-transform') as SVGGElement;
    g.setAttribute('transform', `translate(${this.transform.x},${this.transform.y}) scale(${this.transform.scale})`);
  }

  /** 网格选中单元格 -> 高亮图中相关节点（特性 30） */
  focusAddress(addr: string | null): void {
    state.graphFocusNodes.clear();
    if (!addr || !this.snapshot) {
      this.applyHighlight();
      return;
    }
    // 找到对应 cell 节点及它的 formula/range
    for (const n of this.snapshot.nodes) {
      if (n.kind === 'cell' && n.label === addr) state.graphFocusNodes.add(n.id);
      if (n.kind === 'formula' && n.id === `formula@${addr}`) state.graphFocusNodes.add(n.id);
      if (n.kind === 'range' && this.rangeContains(n.label, addr)) state.graphFocusNodes.add(n.id);
    }
    this.applyHighlight();
  }

  private rangeContains(label: string, addr: string): boolean {
    const [a, b] = label.split(':');
    if (!a || !b) return false;
    return addr >= a && addr <= b;
  }

  setSnapshot(snapshot: GraphSnapshot): void {
    this.snapshot = snapshot;
    this.render();
    requestAnimationFrame(() => this.fit());
  }

  private render(): void {
    if (!this.snapshot) return;
    this.edgeLayer.innerHTML = '';
    this.nodeLayer.innerHTML = '';

    for (const edge of this.snapshot.edges) {
      const s = this.snapshot.nodes.find((n) => n.id === edge.source)!;
      const t = this.snapshot.nodes.find((n) => n.id === edge.target)!;
      const x1 = s.x + NODE_W / 2;
      const y1 = s.y + NODE_H;
      const x2 = t.x + NODE_W / 2;
      const y2 = t.y;
      const midY = (y1 + y2) / 2;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`,
      );
      path.classList.add('graph-edge');
      path.dataset.id = edge.id;
      path.dataset.source = edge.source;
      path.dataset.target = edge.target;
      path.setAttribute('marker-end', 'url(#arrow)');
      this.edgeLayer.appendChild(path);
    }

    for (const node of this.snapshot.nodes) {
      this.nodeLayer.appendChild(this.renderNode(node));
    }
    this.applyHighlight();
  }

  private renderNode(node: SerializedNode): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('graph-node', `node-${node.kind}`);
    g.dataset.id = node.id;
    g.setAttribute('transform', `translate(${node.x},${node.y})`);

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', '6');
    g.appendChild(rect);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(NODE_W / 2));
    text.setAttribute('y', '15');
    text.classList.add('node-label');
    text.textContent = node.kind === 'cell' ? node.label : node.label.length > 14 ? node.label.slice(0, 13) + '…' : node.label;
    g.appendChild(text);

    const kindText = document.createElementNS(SVG_NS, 'text');
    kindText.setAttribute('x', '6');
    kindText.setAttribute('y', String(NODE_H - 5));
    kindText.classList.add('node-kind');
    kindText.textContent = { cell: '单元格', formula: '公式', range: '区域' }[node.kind];
    g.appendChild(kindText);

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${node.label} (${node.kind})`;
    g.appendChild(title);
    return g;
  }

  /** 根据悬停/选中/网格焦点计算上下游并高亮 */
  private applyHighlight(): void {
    if (!this.snapshot) return;
    const activeId = this.hoverId ?? this.selectedId;

    const upstream = new Set<string>();
    const downstream = new Set<string>();
    if (activeId) {
      this.collect(activeId, 'in', upstream);
      this.collect(activeId, 'out', downstream);
    }

    const focusFromGrid = state.graphFocusNodes;
    const anyFocus = activeId !== null || focusFromGrid.size > 0;

    this.nodeLayer.querySelectorAll<SVGGElement>('.graph-node').forEach((el) => {
      const id = el.dataset.id!;
      el.classList.toggle('dimmed', anyFocus && !upstream.has(id) && !downstream.has(id) && id !== activeId && !focusFromGrid.has(id));
      el.classList.toggle('upstream-node', upstream.has(id));
      el.classList.toggle('downstream-node', downstream.has(id));
      el.classList.toggle('active-node', id === activeId);
      el.classList.toggle('grid-focus', focusFromGrid.has(id));
    });
    this.edgeLayer.querySelectorAll<SVGPathElement>('.graph-edge').forEach((el) => {
      const onPath =
        activeId !== null &&
        (upstream.has(el.dataset.source!) || downstream.has(el.dataset.target!) ||
          el.dataset.source === activeId || el.dataset.target === activeId);
      el.classList.toggle('edge-dimmed', anyFocus && !onPath);
      el.classList.toggle('edge-up', onPath && upstream.has(el.dataset.source!));
      el.classList.toggle('edge-down', onPath && downstream.has(el.dataset.target!));
    });

    // 计算单元格地址集合，回调给网格联动
    if (activeId) {
      const upAddrs = this.toAddresses(upstream);
      const downAddrs = this.toAddresses(downstream);
      const node = this.snapshot.nodes.find((n) => n.id === activeId);
      this.cb.onHighlight(upAddrs, downAddrs, node ? this.nodeAddress(node) : null);
    } else {
      // 无悬停/选中时清空网格联动高亮
      this.cb.onHighlight(new Set(), new Set(), null);
    }
  }

  private toAddresses(ids: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const id of ids) {
      const node = this.snapshot?.nodes.find((n) => n.id === id);
      if (!node) continue;
      if (node.kind === 'cell') out.add(node.label);
      else if (node.kind === 'formula') out.add(id.slice('formula@'.length));
      else if (node.kind === 'range') {
        for (const member of this.expandRangeLabel(node.label)) out.add(member);
      }
    }
    return out;
  }

  private expandRangeLabel(label: string): string[] {
    const [a, b] = label.split(':');
    if (!a || !b) return [];
    const parse = (s: string) => {
      const m = /^([A-Z]+)(\d+)$/.exec(s);
      if (!m) return null;
      return { col: m[1]!.charCodeAt(0) - 65, row: Number(m[2]) - 1 };
    };
    const p1 = parse(a);
    const p2 = parse(b);
    if (!p1 || !p2) return [];
    const out: string[] = [];
    for (let r = Math.min(p1.row, p2.row); r <= Math.max(p1.row, p2.row); r++) {
      for (let c = Math.min(p1.col, p2.col); c <= Math.max(p1.col, p2.col); c++) {
        out.push(`${String.fromCharCode(65 + c)}${r + 1}`);
      }
    }
    return out;
  }

  private collect(start: string, dir: 'in' | 'out', result: Set<string>): void {
    if (!this.snapshot) return;
    const attr = dir === 'in' ? 'target' : 'source';
    const nextAttr = dir === 'in' ? 'source' : 'target';
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const edge of this.snapshot.edges) {
        if (edge[attr] !== cur) continue;
        const next = edge[nextAttr];
        if (!result.has(next) && next !== start) {
          result.add(next);
          queue.push(next);
        }
      }
    }
  }
}
