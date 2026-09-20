/**
 * 依赖图（特性 16、17、18；技术点 15、16、17）。
 *
 * 三类节点：
 *   cell    单元格（拥有值；若含公式则关联同键的 formula 节点）
 *   formula 公式 AST（键 = 所在单元格键）
 *   range   区域引用（键 = owner + '|' + A1:B2）
 *
 * 边（dependent -> dependency，方向 = “依赖于”）：
 *   cell(owner)    -> formula              单元格拥有公式
 *   formula        -> range                 公式引用了区域
 *   formula        -> cell                  公式直接引用了单元格
 *   range          -> cell(member)          区域覆盖的单元格
 *
 * 同时维护邻接表 out（依赖边）与逆邻接表 incoming（被依赖边）。
 */
import { canonicalAddress, CellAddress, rangeKey, RangeRef } from './a1';

export type GraphNodeKind = 'cell' | 'formula' | 'range';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** 仅 cell 节点 */
  cell?: CellAddress;
  /** 仅 range 节点 */
  range?: RangeRef;
  /** 仅 formula/range 节点：所属单元格 */
  owner?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** 边的语义说明，供 SVG 悬停提示 */
  reason: 'owns' | 'references-cell' | 'references-range' | 'covers';
}

export function cellId(addr: CellAddress): string {
  return `cell:${canonicalAddress(addr)}`;
}
export function formulaId(addr: CellAddress): string {
  return `formula:${canonicalAddress(addr)}`;
}
export function rangeId(owner: string, range: RangeRef): string {
  return `range:${owner}|${rangeKey(range)}`;
}

export class DependencyGraph {
  readonly nodes = new Map<string, GraphNode>();
  /** 邻接表：id -> 它依赖的节点集合 */
  readonly out = new Map<string, Set<string>>();
  /** 逆邻接表：id -> 依赖它的节点集合 */
  readonly incoming = new Map<string, Set<string>>();

  addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
      this.out.set(node.id, new Set());
      this.incoming.set(node.id, new Set());
    }
  }

  addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(`依赖图边引用了不存在的节点: ${edge.from} -> ${edge.to}`);
    }
    const o = this.out.get(edge.from)!;
    if (o.has(edge.to)) return;
    o.add(edge.to);
    this.incoming.get(edge.to)!.add(edge.from);
    this.edges.push(edge);
  }

  /** 遍历/重建时清空某节点的出边（同时维护逆邻接表）。 */
  clearOutgoing(id: string): void {
    const o = this.out.get(id);
    if (!o) return;
    for (const to of o) {
      this.incoming.get(to)?.delete(id);
    }
    o.clear();
    this.edges = this.edges.filter((e) => e.from !== id);
  }

  edges: GraphEdge[] = [];

  nodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  /** 上游（节点依赖的一切，BFS）。 */
  upstreamOf(id: string): Set<string> {
    return bfs(id, (n) => [...(this.out.get(n) ?? [])]);
  }

  /** 下游（依赖节点的一切，BFS，特性 29）。 */
  downstreamOf(id: string): Set<string> {
    return bfs(id, (n) => [...(this.incoming.get(n) ?? [])]);
  }

  /** 压缩到“公式单元格 -> 引用单元格”的邻接关系（拓扑排序与分层布局用）。 */
  compressedCellEdges(): { out: Map<string, Set<string>>; incoming: Map<string, Set<string>> } {
    const out = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();
    const ensure = (m: Map<string, Set<string>>, k: string): Set<string> => {
      let s = m.get(k);
      if (!s) {
        s = new Set();
        m.set(k, s);
      }
      return s;
    };
    for (const n of this.nodes.values()) {
      if (n.kind === 'cell') {
        ensure(out, n.id);
        ensure(incoming, n.id);
      }
    }
    // formula owner cell -> formula -> (range -> members | direct cell)
    for (const node of this.nodes.values()) {
      if (node.kind !== 'formula' || !node.owner) continue;
      const ownerCell = `cell:${node.owner}`;
      // 自引用判定：公式的“直接数据依赖”是否包含 owner 自身。
      // 仅沿 references-cell / covers 边查找，不能穿过其他单元格的 owns 边，
      // 否则 B29=C29+1、C29=B29+1 的直接环会被误判为各自的自引用。
      if (this.formulaDirectlyReadsCell(node.id, ownerCell)) {
        ensure(out, ownerCell).add(ownerCell);
        ensure(incoming, ownerCell).add(ownerCell);
      }
      for (const upId of this.upstreamOf(node.id)) {
        const upNode = this.nodes.get(upId);
        if (upNode?.kind === 'cell' && upId !== ownerCell) {
          ensure(out, ownerCell).add(upId);
          ensure(incoming, upId).add(ownerCell);
        }
      }
    }
    return { out, incoming };
  }

  /**
   * 公式是否“直接读取”目标单元格：
   * 允许路径 formula -> cell（references-cell）
   * 或 formula -> range -> ... -> cell（references-range + covers），
   * 但禁止穿过 cell -> formula（owns）进入其他单元格的公式，
   * 否则 B29=C29+1、C29=B29+1 的直接环会被误判为各自的自引用。
   */
  private formulaDirectlyReadsCell(formulaNodeId: string, targetCellId: string): boolean {
    const reasonOf = new Map<string, GraphEdge['reason']>();
    for (const e of this.edges) reasonOf.set(`${e.from} ${e.to}`, e.reason);
    const isDataEdge = (from: string, to: string): boolean => {
      const reason = reasonOf.get(`${from} ${to}`);
      return (
        reason === 'references-cell' ||
        reason === 'references-range' ||
        reason === 'covers'
      );
    };
    // direct data edge from the formula itself (self-reference case)
    for (const to of this.out.get(formulaNodeId) ?? []) {
      if (to === targetCellId && isDataEdge(formulaNodeId, to)) return true;
    }
    // walk formula -> range -> covers; never cross an owns edge
    const seen = new Set<string>();
    const queue = [formulaNodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const to of this.out.get(cur) ?? []) {
        if (!isDataEdge(cur, to)) continue;
        if (to === targetCellId) return true;
        queue.push(to);
      }
    }
    return false;
  }
}

function bfs(start: string, neighbors: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  // 不把起点本身标记为“关联节点”，调用方自行决定是否包含
  const queued = new Set<string>([start]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighbors(cur)) {
      if (n === start || seen.has(n) || queued.has(n)) continue;
      seen.add(n);
      queued.add(n);
      queue.push(n);
    }
  }
  return seen;
}
