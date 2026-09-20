/**
 * 拓扑排序测试（技术 27，特性 20、22）。
 */
import { describe, expect, it } from 'vitest';
import { kahnTopo, dfsTopo, detectCycles, classifyCycle, type AdjacencyInput } from '../src/core/topology.js';

/** 便捷构造：spec 为 [id, ...依赖] */
function build(spec: Array<[string, ...string[]]>): AdjacencyInput & { ids: string[] } {
  const deps = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const ids: string[] = [];
  for (const [id, ...up] of spec) {
    ids.push(id);
    deps.set(id, new Set(up));
    for (const u of up) {
      if (!dependents.has(u)) dependents.set(u, new Set());
      dependents.get(u)!.add(id);
    }
  }
  return { deps, dependents, ids };
}

function indexOf(order: string[], id: string): number {
  return order.indexOf(id);
}

describe('Kahn 拓扑排序', () => {
  it('依赖项排在前面', () => {
    const adj = build([
      ['a'],
      ['b', 'a'],
      ['c', 'a'],
      ['d', 'b', 'c'],
    ]);
    const { order, cyclic } = kahnTopo(adj.ids, adj);
    expect(cyclic.size).toBe(0);
    expect(indexOf(order, 'a')).toBeLessThan(indexOf(order, 'b'));
    expect(indexOf(order, 'a')).toBeLessThan(indexOf(order, 'c'));
    expect(indexOf(order, 'b')).toBeLessThan(indexOf(order, 'd'));
    expect(indexOf(order, 'c')).toBeLessThan(indexOf(order, 'd'));
    expect(order).toHaveLength(4);
  });

  it('无依赖图按确定性顺序输出', () => {
    const adj = build([['b'], ['a'], ['c']]);
    const { order } = kahnTopo(adj.ids, adj);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('DFS 拓扑排序', () => {
  it('后序保证上游先出现', () => {
    const adj = build([['d', 'b', 'c'], ['b', 'a'], ['c', 'a'], ['a']]);
    const { order, cyclic } = dfsTopo(adj.ids, adj);
    expect(cyclic.size).toBe(0);
    expect(indexOf(order, 'a')).toBeLessThan(indexOf(order, 'b'));
    expect(indexOf(order, 'c')).toBeLessThan(indexOf(order, 'd'));
  });
});

describe('循环检测（特性 23）', () => {
  it('无环', () => {
    const adj = build([['a'], ['b', 'a']]);
    const report = detectCycles(adj.ids, adj);
    expect(report.cyclic.size).toBe(0);
  });

  it('自引用循环 A -> A', () => {
    const adj = build([['a', 'a']]);
    const report = detectCycles(adj.ids, adj);
    expect(report.selfLoops).toContain('a');
    expect(report.cyclic.has('a')).toBe(true);
  });

  it('直接循环 A -> B -> A', () => {
    const adj = build([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    const report = detectCycles(adj.ids, adj);
    expect(report.cyclic.has('a')).toBe(true);
    expect(report.cyclic.has('b')).toBe(true);
    const path = report.cycles[0]!;
    expect(classifyCycle(path)).toBe('direct');
  });

  it('间接循环 A -> B -> C -> A', () => {
    const adj = build([
      ['a', 'c'],
      ['b', 'a'],
      ['c', 'b'],
    ]);
    const report = detectCycles(adj.ids, adj);
    expect(report.cyclic.size).toBe(3);
    const path = report.cycles[0]!;
    expect(classifyCycle(path)).toBe('indirect');
  });

  it('Kahn/DFS 都把循环节点排除出 order', () => {
    const adj = build([
      ['a', 'b'],
      ['b', 'a'],
      ['c', 'a'], // 依赖循环但自身不在环上
    ]);
    const k = kahnTopo(adj.ids, adj);
    const d = dfsTopo(adj.ids, adj);
    expect(k.cyclic.has('a')).toBe(true);
    expect(k.cyclic.has('b')).toBe(true);
    expect(k.order).not.toContain('a');
    expect(d.order).not.toContain('a');
    // c 自身不在环上（虽然它的值会被 #CIRC! 污染）
    expect(d.cyclic.has('c')).toBe(false);
  });
});
