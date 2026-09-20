/**
 * 依赖图测试（技术 26，特性 16-19）。
 */
import { describe, expect, it } from 'vitest';
import {
  DependencyGraph,
  cellId,
  formulaId,
  rangeId,
} from '../src/core/graph.js';

describe('DependencyGraph 邻接表/逆邻接表', () => {
  it('添加 cell / formula / range 三类节点', () => {
    const g = new DependencyGraph();
    g.addNode({ id: cellId(0, 0), kind: 'cell', label: 'A1' });
    g.addNode({ id: formulaId('A1'), kind: 'formula', label: '=1', ownerCell: cellId(0, 0) });
    g.addNode({ id: rangeId('B1:B3'), kind: 'range', label: 'B1:B3' });
    expect(g.nodeCount).toBe(3);
  });

  it('邻接表（下游）与逆邻接表（上游）同时维护', () => {
    const g = new DependencyGraph();
    g.addNode({ id: 'a', kind: 'cell', label: 'a' });
    g.addNode({ id: 'b', kind: 'cell', label: 'b' });
    g.addNode({ id: 'c', kind: 'cell', label: 'c' });
    // a -> b -> c：c 依赖 b，b 依赖 a
    g.addEdge('a', 'b');
    g.addEdge('b', 'c');

    expect([...g.dependentsOf('a')]).toEqual(['b']);
    expect([...g.dependenciesOf('c')]).toEqual(['b']);
    expect(g.edgeCount).toBe(2);
  });

  it('重复边去重', () => {
    const g = new DependencyGraph();
    g.addNode({ id: 'a', kind: 'cell', label: 'a' });
    g.addNode({ id: 'b', kind: 'cell', label: 'b' });
    g.addEdge('a', 'b');
    g.addEdge('a', 'b');
    expect(g.edgeCount).toBe(1);
  });

  it('BFS 全部上游 / 下游', () => {
    const g = new DependencyGraph();
    for (const id of ['a', 'b', 'c', 'd']) g.addNode({ id, kind: 'cell', label: id });
    g.addEdge('a', 'b');
    g.addEdge('b', 'c');
    g.addEdge('a', 'd');
    expect([...g.upstreamOf('c')].sort()).toEqual(['a', 'b']);
    expect([...g.downstreamOf('a')].sort()).toEqual(['b', 'c', 'd']);
  });

  it('连接未知节点抛错', () => {
    const g = new DependencyGraph();
    g.addNode({ id: 'a', kind: 'cell', label: 'a' });
    expect(() => g.addEdge('a', 'x')).toThrow();
  });
});
