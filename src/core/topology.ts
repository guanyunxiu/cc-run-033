/**
 * 拓扑排序（特性 20）与循环检测（特性 23）。
 *
 * 图的边方向为 data-flow：dep -> cell（入边 = 依赖项）。
 * 求值时被依赖者必须先计算，因此排序结果为“入度归零”顺序，
 * 即 Kahn 以 in-degree（依赖数量）为基准。
 *
 *  - Kahn（技术 18）
 *  - DFS 拓扑（技术 19）
 *  - DFS 三色标记（技术 20）：白=未访问，灰=在递归栈，黑=完成；
 *    遇到灰色节点即发现回边（循环）。
 */

/** 轻量邻接结构：deps[id] = 该节点依赖的节点集合（入边来源） */
export interface AdjacencyInput {
  deps: Map<string, Set<string>>; // 逆邻接表：id -> 上游
  dependents: Map<string, Set<string>>; // 邻接表：id -> 下游
}

export interface TopoResult {
  /** 拓扑序（循环上的节点不包含在内） */
  order: string[];
  /** 参与循环的节点（无法排序） */
  cyclic: Set<string>;
  /** 算法名（用于调试面板展示） */
  algorithm: 'kahn' | 'dfs';
}

function compareIds(a: string, b: string): number {
  // 确定性顺序：cell@col,row 字典序即可（仅作为同入度 tiebreak）
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Kahn 算法 */
export function kahnTopo(
  ids: Iterable<string>,
  adj: AdjacencyInput,
): TopoResult {
  const inDegree = new Map<string, number>();
  for (const id of ids) inDegree.set(id, (adj.deps.get(id) ?? new Set()).size);

  // 初始入度为 0 的节点（无依赖）
  let ready: string[] = [];
  for (const [id, d] of inDegree) if (d === 0) ready.push(id);
  ready.sort(compareIds);

  const order: string[] = [];
  while (ready.length) {
    const cur = ready.shift()!;
    order.push(cur);
    const newly: string[] = [];
    for (const down of adj.dependents.get(cur) ?? []) {
      const deg = (inDegree.get(down) ?? 0) - 1;
      inDegree.set(down, deg);
      if (deg === 0) newly.push(down);
    }
    if (newly.length) {
      newly.sort(compareIds);
      ready = ready.concat(newly).sort(compareIds);
    }
  }

  const cyclic = new Set<string>();
  for (const [id, d] of inDegree) if (d > 0) cyclic.add(id);
  return { order, cyclic, algorithm: 'kahn' };
}

/**
 * DFS 拓扑排序 + 三色标记循环检测。
 * 返回的顺序保证：节点在其依赖项之后出现（后序反转）。
 */
export function dfsTopo(ids: Iterable<string>, adj: AdjacencyInput): TopoResult {
  // 0 = 白，1 = 灰（栈中），2 = 黑（完成）
  const color = new Map<string, 0 | 1 | 2>();
  const idList = [...ids].sort(compareIds);
  for (const id of idList) color.set(id, 0);

  const order: string[] = [];
  const cyclic = new Set<string>();

  const visit = (id: string, stack: Set<string>): void => {
    color.set(id, 1);
    stack.add(id);
    // 先访问依赖（上游），保证上游先完成
    const ups = [...(adj.deps.get(id) ?? [])].sort(compareIds);
    for (const up of ups) {
      const c = color.get(up);
      if (c === undefined) continue; // 依赖了图外节点（理论上不会）
      if (c === 0) {
        visit(up, stack);
      } else if (c === 1) {
        // 回边 => 回路上所有栈节点都标记为循环
        for (const s of stack) cyclic.add(s);
        cyclic.add(up);
      }
    }
    stack.delete(id);
    color.set(id, 2);
    order.push(id);
  };

  for (const id of idList) {
    if (color.get(id) === 0) visit(id, new Set());
  }

  // 循环节点从顺序中剔除
  const safe = order.filter((id) => !cyclic.has(id));
  return { order: safe, cyclic, algorithm: 'dfs' };
}

/**
 * 仅做三色循环检测（特性 23），返回循环分组。
 * 每个分组是一条回边路径，便于分类：
 *  - 自引用循环：A -> A
 *  - 直接循环：A -> B -> A
 *  - 间接循环：A -> B -> C -> A
 */
export interface CycleReport {
  cyclic: Set<string>;
  selfLoops: string[];
  cycles: string[][];
}

export function detectCycles(ids: Iterable<string>, adj: AdjacencyInput): CycleReport {
  const color = new Map<string, 0 | 1 | 2>();
  const idList = [...ids].sort(compareIds);
  for (const id of idList) color.set(id, 0);

  const selfLoops: string[] = [];
  const cycles: string[][] = [];

  // 自引用单独识别（特性 23）
  for (const id of idList) {
    if (adj.deps.get(id)?.has(id)) selfLoops.push(id);
  }

  const visit = (id: string, stackPath: string[]): void => {
    color.set(id, 1);
    stackPath.push(id);
    for (const up of [...(adj.deps.get(id) ?? [])].sort(compareIds)) {
      const c = color.get(up);
      if (c === undefined) continue;
      if (c === 0) {
        visit(up, stackPath);
      } else if (c === 1) {
        const start = stackPath.indexOf(up);
        if (start >= 0) cycles.push(stackPath.slice(start).concat(up));
      }
    }
    stackPath.pop();
    color.set(id, 2);
  };

  for (const id of idList) {
    if (color.get(id) === 0) visit(id, []);
  }

  const cyclic = new Set<string>(selfLoops);
  for (const c of cycles) for (const id of c) cyclic.add(id);
  return { cyclic, selfLoops, cycles };
}

/** 分类一条循环路径 */
export function classifyCycle(path: string[]): 'self' | 'direct' | 'indirect' {
  // path 形如 [A, B, ..., A]，首尾相同
  const interior = path.length - 2; // 去掉首尾重复的 A
  if (interior <= 0) return 'self';
  if (interior === 1) return 'direct';
  return 'indirect';
}
