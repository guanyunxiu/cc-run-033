/**
 * 主线程共享 UI 状态：当前快照、选区、联动高亮集合。
 */
import type { EngineSnapshot } from '../core/types.js';

export interface CellPoint {
  row: number;
  col: number;
}

export interface Selection {
  /** 活动单元格（锚点） */
  active: CellPoint;
  /** 框选区域（可与 active 重合） */
  anchor: CellPoint;
  /** 多选区域（按住 Ctrl/点击表头） */
  ranges: Array<{ top: number; left: number; bottom: number; right: number }>;
}

export interface UiState {
  snapshot: EngineSnapshot | null;
  selection: Selection;
  /** 图中选中/悬停的节点对应的地址集合（网格联动） */
  graphHighlight: {
    upstream: Set<string>;
    downstream: Set<string>;
    active: string | null;
  } | null;
  /** 网格选中触发的图高亮节点集合 */
  graphFocusNodes: Set<string>;
}

export const state: UiState = {
  snapshot: null,
  selection: {
    active: { row: 0, col: 0 },
    anchor: { row: 0, col: 0 },
    ranges: [{ top: 0, left: 0, bottom: 0, right: 0 }],
  },
  graphHighlight: null,
  graphFocusNodes: new Set(),
};

export function normalizeRange(a: CellPoint, b: CellPoint): Selection['ranges'][number] {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function pointInRange(
  p: CellPoint,
  r: Selection['ranges'][number],
): boolean {
  return p.row >= r.top && p.row <= r.bottom && p.col >= r.left && p.col <= r.right;
}

/**
 * 基于快照邻接做 BFS，计算某地址的全部上游/下游（特性 29）。
 * 同时合并图交互（graphHighlight）产生的高亮集合。
 */
export function computeCellHighlight(addr: string): {
  upstream: Set<string>;
  downstream: Set<string>;
} {
  const snapshot = state.snapshot;
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  if (!snapshot) return { upstream, downstream };

  const walk = (
    start: string,
    getNext: (addr: string) => string[],
    into: Set<string>,
  ): void => {
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of getNext(cur)) {
        if (!into.has(n) && n !== start) {
          into.add(n);
          queue.push(n);
        }
      }
    }
  };

  const cell = snapshot.cells[addr];
  if (cell) {
    walk(addr, (a) => snapshot.cells[a]?.deps ?? [], upstream);
    walk(addr, (a) => snapshot.cells[a]?.dependents ?? [], downstream);
  }

  // 与图悬停联动高亮合并
  if (state.graphHighlight) {
    for (const u of state.graphHighlight.upstream) upstream.add(u);
    for (const d of state.graphHighlight.downstream) downstream.add(d);
  }
  return { upstream, downstream };
}
