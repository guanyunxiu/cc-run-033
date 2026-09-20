/**
 * 基础分层布局（技术 22）：按“依赖深度”分层。
 *
 * layer(cell) = 0 若该单元格不依赖任何其他 cell；
 * 否则 layer = 1 + max(layer(dep))。
 * 同层节点纵向排列，层间横向展开。
 *
 * 循环上的节点无法定义深度，统一放到最右侧的 “cycle” 层。
 */
import type { AdjacencyInput } from './topology.js';

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  layer: number;
}

export interface LayoutOptions {
  colWidth?: number;
  rowHeight?: number;
  nodeWidth?: number;
}

export function layeredLayout(
  ids: Iterable<string>,
  adj: AdjacencyInput,
  cyclic: ReadonlySet<string>,
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const colWidth = options.colWidth ?? 190;
  const rowHeight = options.rowHeight ?? 54;
  const layerOf = new Map<string, number>();
  const idSet = new Set(ids);

  // 记忆化 DFS（跳过循环节点）
  const resolve = (id: string, visiting: Set<string>): number => {
    if (layerOf.has(id)) return layerOf.get(id)!;
    if (cyclic.has(id)) return -1;
    if (visiting.has(id)) return -1;
    visiting.add(id);
    let maxDep = -1;
    for (const dep of adj.deps.get(id) ?? []) {
      if (!idSet.has(dep) || cyclic.has(dep)) continue;
      maxDep = Math.max(maxDep, resolve(dep, visiting));
    }
    visiting.delete(id);
    const layer = maxDep + 1;
    layerOf.set(id, layer);
    return layer;
  };

  for (const id of ids) resolve(id, new Set());

  // 按层分组
  const layers = new Map<number, string[]>();
  const cycleLayerId = -999;
  for (const id of ids) {
    const layer = cyclic.has(id) ? cycleLayerId : (layerOf.get(id) ?? 0);
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(id);
  }

  const result = new Map<string, { x: number; y: number }>();
  const normalLayers = [...layers.keys()]
    .filter((l) => l !== cycleLayerId)
    .sort((a, b) => a - b);
  const orderedLayers = [...normalLayers];
  if (layers.has(cycleLayerId)) orderedLayers.push(cycleLayerId);

  const maxCount = Math.max(...[...layers.values()].map((g) => g.length), 1);
  if (layers.size === 0) return result;

  orderedLayers.forEach((layer, colIndex) => {
    const group = layers.get(layer)!;
    group.sort();
    const offset = (maxCount - group.length) / 2;
    group.forEach((id, rowIndex) => {
      result.set(id, {
        x: 60 + colIndex * colWidth,
        y: 40 + (rowIndex + offset) * rowHeight,
      });
    });
  });

  return result;
}
