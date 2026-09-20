import { describe, expect, it } from 'vitest';
import {
  classifyCycle,
  dfsTopSortWithCycles,
  kahnTopSort,
} from '../src/engine/topology';

function build(pairs: [string, string[]][]): {
  out: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
} {
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
  for (const [node, deps] of pairs) {
    ensure(out, node);
    ensure(incoming, node);
    for (const d of deps) {
      ensure(out, d);
      ensure(incoming, d);
      ensure(out, node).add(d);
      ensure(incoming, d).add(node);
    }
  }
  return { out, incoming };
}

describe('Kahn 拓扑排序（技术点 18）', () => {
  it('线性链：被依赖者在前', () => {
    const { out, incoming } = build([
      ['C', ['B']],
      ['B', ['A']],
      ['A', []],
    ]);
    const r = kahnTopSort(out, incoming);
    expect(r.cyclicNodes.size).toBe(0);
    expect(r.order).toEqual(['A', 'B', 'C']);
  });

  it('菱形依赖', () => {
    const { out, incoming } = build([
      ['D', ['B', 'C']],
      ['B', ['A']],
      ['C', ['A']],
      ['A', []],
    ]);
    const r = kahnTopSort(out, incoming);
    expect(r.order).toEqual(['A', 'B', 'C', 'D']);
  });

  it('环上节点被识别为 cyclic，依赖环的节点为 blocked', () => {
    const { out, incoming } = build([
      ['A', ['B']],
      ['B', ['A']],
      ['C', ['A']],
    ]);
    const r = kahnTopSort(out, incoming);
    expect([...r.cyclicNodes].sort()).toEqual(['A', 'B']);
    expect([...r.blockedNodes]).toEqual(['C']);
    expect(r.order).toEqual([]);
  });
});

describe('DFS 拓扑排序与三色标记循环检测（技术点 19/20）', () => {
  it('无环图后序即重算顺序', () => {
    const { out } = build([
      ['C', ['B']],
      ['B', ['A']],
      ['A', []],
    ]);
    const r = dfsTopSortWithCycles(out);
    expect(r.cyclicNodes.size).toBe(0);
    expect(r.order).toEqual(['A', 'B', 'C']);
  });

  it('检测自引用循环', () => {
    const { out } = build([['A', ['A']]]);
    const r = dfsTopSortWithCycles(out);
    expect(r.cyclicNodes.has('A')).toBe(true);
    expect(r.cycles).toHaveLength(1);
    expect(classifyCycle(r.cycles[0]!)).toBe('self');
  });

  it('检测直接循环 A<->B', () => {
    const { out } = build([
      ['A', ['B']],
      ['B', ['A']],
    ]);
    const r = dfsTopSortWithCycles(out);
    expect([...r.cyclicNodes].sort()).toEqual(['A', 'B']);
    expect(r.cycles.every((c) => classifyCycle(c) === 'direct')).toBe(true);
  });

  it('检测间接循环 A->B->C->A', () => {
    const { out } = build([
      ['A', ['B']],
      ['B', ['C']],
      ['C', ['A']],
    ]);
    const r = dfsTopSortWithCycles(out);
    expect([...r.cyclicNodes].sort()).toEqual(['A', 'B', 'C']);
    expect(r.cycles.some((c) => classifyCycle(c) === 'indirect')).toBe(true);
  });

  it('环外的下游节点不被误判为环节点（特性 24）', () => {
    const { out } = build([
      ['A', ['B']],
      ['B', ['A']],
      ['C', ['A']],
      ['D', []],
    ]);
    const r = dfsTopSortWithCycles(out);
    expect(r.cyclicNodes.has('C')).toBe(false);
    expect(r.blockedNodes.has('C')).toBe(true);
    expect(r.order).toContain('D');
    expect(r.order).not.toContain('C');
  });
});
