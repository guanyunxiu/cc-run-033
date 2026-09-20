/**
 * 依赖图（特性 16-18，技术 15-17）。
 *
 * 节点（GraphNode）：
 *  - cell    单元格（值节点或公式宿主单元格都用 cell）
 *  - formula 公式节点（挂在公式单元格之下，展示 AST 公式）
 *  - range   区域节点（如 A1:B3，聚合区域依赖）
 *
 * 边方向统一为 data-flow：source -> target 表示 target 依赖 source，
 * 即 source 变化会影响 target。
 *
 * 维护两套邻接表：
 *  - outEdges（邻接表 / forward）：node -> 它流向的节点（下游）
 *  - inEdges（逆邻接表 / reverse）：node -> 流向它的节点（上游）
 */
import type { GraphEdgeKind, GraphNodeKind, GraphSnapshot, SerializedEdge, SerializedNode } from './types.js';
import type { RangeRef } from './dependencies.js';
import { formatRect } from './address.js';

export interface GraphNodeData {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** cell 节点的行列 */
  row?: number;
  col?: number;
  /** 所属 cell（formula / range 节点归属） */
  ownerCell?: string;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

export function cellId(row: number, col: number): string {
  return `cell@${col},${row}`;
}

/** 解析 cellId 回 row/col */
export function parseCellId(id: string): { row: number; col: number } {
  const [col, row] = id.slice('cell@'.length).split(',').map(Number);
  return { col: col!, row: row! };
}
export function formulaId(addr: string): string {
  return `formula@${addr}`;
}
export function rangeId(label: string): string {
  return `range@${label}`;
}

export function rangeRefId(r: RangeRef): string {
  return rangeId(formatRect(r));
}

export class DependencyGraph {
  readonly nodes = new Map<string, GraphNodeData>();
  /** 邻接表：id -> 出边目标集合（下游） */
  readonly outEdges = new Map<string, Set<string>>();
  /** 逆邻接表：id -> 入边来源集合（上游） */
  readonly inEdges = new Map<string, Set<string>>();
  private readonly edgeSet = new Set<string>();

  addNode(node: GraphNodeData): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
      this.outEdges.set(node.id, new Set());
      this.inEdges.set(node.id, new Set());
    }
  }

  /**
   * 添加边 source -> target（target 依赖 source）。
   * kind='depends' 用于“target 的依赖边”视角；序列化时同一物理边同时表达两种语义。
   */
  addEdge(source: string, target: string, kind: GraphEdgeKind = 'depends'): void {
    if (!this.nodes.has(source)) throw new Error(`未知节点: ${source}`);
    if (!this.nodes.has(target)) throw new Error(`未知节点: ${target}`);
    const id = `${source}->${target}`;
    if (this.edgeSet.has(id)) return;
    this.edgeSet.add(id);
    this.outEdges.get(source)!.add(target);
    this.inEdges.get(target)!.add(source);
    // kind 记录在边上（默认 depends；depended-by 是同一关系的逆视角）
    void kind;
  }

  /** 直接上游（依赖项） */
  dependenciesOf(id: string): Set<string> {
    return this.inEdges.get(id) ?? new Set();
  }

  /** 直接下游（被依赖项） */
  dependentsOf(id: string): Set<string> {
    return this.outEdges.get(id) ?? new Set();
  }

  /** BFS 收集全部上游（特性 29） */
  upstreamOf(id: string): Set<string> {
    return this.collect(id, (n) => this.inEdges.get(n) ?? new Set());
  }

  /** BFS 收集全部下游 */
  downstreamOf(id: string): Set<string> {
    return this.collect(id, (n) => this.outEdges.get(n) ?? new Set());
  }

  private collect(start: string, next: (id: string) => Set<string>): Set<string> {
    const result = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of next(cur)) {
        if (!result.has(n) && n !== start) {
          result.add(n);
          queue.push(n);
        }
      }
    }
    return result;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edgeSet.size;
  }

  /** 序列化为可跨 postMessage 传递的快照 */
  serialize(layout?: Map<string, { x: number; y: number }>): GraphSnapshot {
    const nodes: SerializedNode[] = [];
    for (const n of this.nodes.values()) {
      const pos = layout?.get(n.id);
      nodes.push({ id: n.id, kind: n.kind, label: n.label, x: pos?.x ?? 0, y: pos?.y ?? 0 });
    }
    const edges: SerializedEdge[] = [];
    for (const [source, targets] of this.outEdges) {
      for (const target of targets) {
        edges.push({ id: `${source}->${target}`, source, target, kind: 'depends' });
      }
    }
    return { nodes, edges };
  }
}
