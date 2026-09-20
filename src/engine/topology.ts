/**
 * 拓扑排序与循环检测（特性 20、23；技术点 18 Kahn、19 DFS、20 三色标记）。
 *
 * 输入统一为邻接表 out: node -> 它依赖的节点。
 * 重算顺序 = 被依赖者在前（先算上游），因此：
 *   - DFS：完成顺序（后序）即重算顺序；
 *   - Kahn：在逆邻接表（incoming）上取“无依赖”节点。
 */

export interface TopologyResult {
  /** 合法的重算顺序 */
  order: string[];
  /** 真正处于环上的节点（DFS 回边确认） */
  cyclicNodes: Set<string>;
  /** 不在环上、但依赖了环、因此无法按正常顺序求值的节点 */
  blockedNodes: Set<string>;
}

/* ---------------- Kahn 算法 ---------------- */

export function kahnTopSort(
  out: Map<string, Set<string>>,
  incoming: Map<string, Set<string>>,
): TopologyResult {
  // remainingDeps：节点尚未完成的依赖数（出度）
  const remainingDeps = new Map<string, number>();
  for (const id of out.keys()) remainingDeps.set(id, out.get(id)?.size ?? 0);

  const queue: string[] = [];
  for (const [id, deg] of remainingDeps) if (deg === 0) queue.push(id);

  const order: string[] = [];
  const enqueued = new Set<string>(queue);

  while (queue.length) {
    // 保持稳定的可展示顺序：队列按字典序取最小
    queue.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const node = queue.shift()!;
    order.push(node);
    // node 完成后，所有把 node 当依赖的节点剩余依赖数 -1
    for (const dependent of incoming.get(node) ?? []) {
      const d = (remainingDeps.get(dependent) ?? 1) - 1;
      remainingDeps.set(dependent, d);
      if (d === 0 && !enqueued.has(dependent)) {
        enqueued.add(dependent);
        queue.push(dependent);
      }
    }
  }

  // Kahn 无法区分“环上节点”与“依赖环的阻塞节点”。
  // 规则：剩余依赖中，至少有一个依赖也是未完成节点 => 可能在环上；
  // 再用一次 DFS 精确标记环，剩余节点归类为 blocked。
  const unfinished = new Set<string>();
  for (const [id, deg] of remainingDeps) if (deg > 0) unfinished.add(id);

  const dfs = dfsTopSortWithCycles(out);
  const cyclicNodes = new Set<string>();
  for (const id of unfinished) {
    if (dfs.cyclicNodes.has(id)) cyclicNodes.add(id);
  }
  const blockedNodes = new Set<string>();
  for (const id of unfinished) {
    if (!cyclicNodes.has(id)) blockedNodes.add(id);
  }
  return { order, cyclicNodes, blockedNodes };
}

/* ---------------- DFS 拓扑排序 + 三色标记循环检测 ---------------- */

export type DfsColor = 0 | 1 | 2; // 0 白（未访问） 1 灰（在当前栈上） 2 黑（完成）

export interface DfsCycleResult {
  order: string[];
  cyclicNodes: Set<string>;
  /** 不在环上、但（传递）依赖了环的节点 */
  blockedNodes: Set<string>;
  /** 检测到的所有简单环路径（用于错误面板展示自引用/直接/间接循环） */
  cycles: string[][];
}

/**
 * 三色标记 DFS。
 * @param out 邻接表（node -> 依赖）
 */
export function dfsTopSortWithCycles(out: Map<string, Set<string>>): DfsCycleResult {
  const color = new Map<string, DfsColor>();
  for (const id of out.keys()) color.set(id, 0);

  const order: string[] = [];
  const cyclicNodes = new Set<string>();
  const blockedNodes = new Set<string>();
  const cycles: string[][] = [];
  const stackPath: string[] = [];
  const onPath = new Set<string>();

  const visit = (node: string): void => {
    color.set(node, 1);
    stackPath.push(node);
    onPath.add(node);

    const neighbors = [...(out.get(node) ?? [])].sort();
    for (const next of neighbors) {
      const c = color.get(next) ?? 0;
      if (c === 0) {
        visit(next);
        // 回溯后若 next 已被确认属于环，则当前节点不是环（环节点在展开时标记）
      } else if (c === 1) {
        // 发现回边 -> 提取环路径
        const startIdx = stackPath.indexOf(next);
        const cyclePath = stackPath.slice(startIdx).concat(next);
        cycles.push(cyclePath);
        for (const n of cyclePath) cyclicNodes.add(n);
      }
      // c === 2：跨边/前向边，忽略
    }

    stackPath.pop();
    onPath.delete(node);
    color.set(node, 2);
    order.push(node);
  };

  for (const id of [...out.keys()].sort()) {
    if ((color.get(id) ?? 0) === 0) visit(id);
  }

  // 同一个简单环可能由多条回边重复记录，按规范化签名去重
  const uniqueCycles: string[][] = [];
  const signatures = new Set<string>();
  for (const path of cycles) {
    const nodes = path.slice(0, -1);
    const minIdx = nodes.reduce(
      (mi, n, i) => (n < nodes[mi]! ? i : mi),
      0,
    );
    const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
    const sig = rotated.join('|');
    if (!signatures.has(sig)) {
      signatures.add(sig);
      uniqueCycles.push([...rotated, rotated[0]!]);
    }
  }

  // 后序顺序即“被依赖者先完成”，但环上节点也被排进了 order；
  // 对外返回的合法顺序剔除环上节点。
  const cleanOrder = order.filter((id) => !cyclicNodes.has(id));
  // 顺序中被放在环之后、但依赖环的节点归入 blocked
  for (const id of cleanOrder) {
    for (const dep of out.get(id) ?? []) {
      if (cyclicNodes.has(dep) || blockedNodes.has(dep)) {
        blockedNodes.add(id);
        break;
      }
    }
  }
  const finalOrder = cleanOrder.filter((id) => !blockedNodes.has(id));
  return { order: finalOrder, cyclicNodes, blockedNodes, cycles: uniqueCycles };
}

/** 循环分类（特性 23）。 */
export type CycleKind = 'self' | 'direct' | 'indirect';

export function classifyCycle(cyclePath: string[]): CycleKind {
  // path 形如 [A, ..., A]
  const nodes = cyclePath.slice(0, -1);
  if (nodes.length === 1) return 'self';
  if (nodes.length === 2) return 'direct';
  return 'indirect';
}
