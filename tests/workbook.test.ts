/**
 * WorkbookEngine 集成测试：解析→依赖图→拓扑→全量重算。
 */
import { describe, expect, it } from 'vitest';
import { WorkbookEngine } from '../src/core/workbook.js';

function makeEngine(entries: Array<[string, string]>, algorithm: 'kahn' | 'dfs' = 'kahn') {
  const engine = new WorkbookEngine({ rows: 100, cols: 26, topoAlgorithm: algorithm });
  for (const [addr, raw] of entries) {
    const m = /^([A-Z])(\d+)$/.exec(addr)!;
    engine.setCell(Number(m[2]) - 1, m[1]!.charCodeAt(0) - 65, raw);
  }
  return engine.recalc();
}

describe('全量重算与重算顺序（特性 21、22）', () => {
  it('按依赖顺序计算链 D1=A1+1, D2=D1*2', () => {
    const snap = makeEngine([
      ['A1', '10'],
      ['D1', '=A1+1'],
      ['D2', '=D1*2'],
    ]);
    expect(snap.cells.A1!.value).toEqual({ type: 'number', value: 10 });
    expect(snap.cells.D1!.value).toEqual({ type: 'number', value: 11 });
    expect(snap.cells.D2!.value).toEqual({ type: 'number', value: 22 });

    const idx = Object.fromEntries(snap.order.map((o) => [o.address, o.order]));
    expect(idx.A1!).toBeLessThan(idx.D1!);
    expect(idx.D1!).toBeLessThan(idx.D2!);
  });

  it('区域公式 SUM(A1:A3)', () => {
    const snap = makeEngine([
      ['A1', '1'],
      ['A2', '2'],
      ['A3', '3'],
      ['C1', '=SUM(A1:A3)'],
    ]);
    expect(snap.cells.C1!.value).toEqual({ type: 'number', value: 6 });
    expect(snap.cells.C1!.deps.sort()).toEqual(['A1', 'A2', 'A3']);
  });

  it('逆邻接：A1 的 dependents 含 C1', () => {
    const snap = makeEngine([
      ['A1', '1'],
      ['C1', '=A1*2'],
    ]);
    expect(snap.cells.A1!.dependents).toContain('C1');
  });
});

describe('循环检测与 #CIRC!（特性 23、24）', () => {
  it('自引用 => #CIRC!', () => {
    const snap = makeEngine([['A1', '=A1+1']]);
    expect(snap.cells.A1!.value.type).toBe('error');
    if (snap.cells.A1!.value.type === 'error') {
      expect(snap.cells.A1!.value.kind).toBe('#CIRC!');
    }
    expect(snap.circularNodes).toContain('A1');
  });

  it('直接循环 A1<->A2 都是 #CIRC!', () => {
    const snap = makeEngine([
      ['A1', '=A2+1'],
      ['A2', '=A1+1'],
    ]);
    expect(snap.cells.A1!.value.type).toBe('error');
    expect(snap.cells.A2!.value.type).toBe('error');
    expect(snap.circularNodes.sort()).toEqual(['A1', 'A2']);
  });

  it('间接循环 A1->B1->C1->A1', () => {
    const snap = makeEngine([
      ['A1', '=C1'],
      ['B1', '=A1'],
      ['C1', '=B1'],
    ]);
    expect(snap.circularNodes.sort()).toEqual(['A1', 'B1', 'C1']);
  });

  it('依赖循环节点的普通单元格得到传播错误而非自身标记为循环', () => {
    const snap = makeEngine([
      ['A1', '=A2'],
      ['A2', '=A1'],
      ['A3', '=A2+1'],
    ]);
    // A3 不在环上，但读取了 #CIRC!，值为错误
    expect(snap.circularNodes.sort()).toEqual(['A1', 'A2']);
    expect(snap.cells.A3!.value.type).toBe('error');
  });

  it('DFS 模式同样检测循环', () => {
    const snap = makeEngine(
      [
        ['A1', '=A2'],
        ['A2', '=A1'],
      ],
      'dfs',
    );
    expect(snap.debug.topoAlgorithm).toBe('dfs');
    expect(snap.circularNodes).toHaveLength(2);
  });
});

describe('错误收集与传播（特性 25、26、32）', () => {
  it('错误列表聚合所有错误单元格', () => {
    const snap = makeEngine([
      ['A1', '=1/0'],
      ['A2', '=A1+1'],
      ['A3', '=FOO(1)'],
      ['A4', '="x"+1'],
    ]);
    const kinds = Object.fromEntries(snap.errors.map((e) => [e.address, e.kind]));
    expect(kinds.A1).toBe('#DIV/0!');
    expect(kinds.A2).toBe('#DIV/0!'); // 传播
    expect(kinds.A3).toBe('#NAME?');
    expect(kinds.A4).toBe('#VALUE!');
  });

  it('解析错误单元格保存 offset 定位', () => {
    const snap = makeEngine([['A1', '=SUM(1,']]);
    expect(snap.cells.A1!.parseError).toBeDefined();
    expect(snap.cells.A1!.parseError!.offset).toBeGreaterThanOrEqual(0);
    expect(snap.cells.A1!.value.type).toBe('error');
  });
});

describe('AST 缓存（技术 10）', () => {
  it('相同公式不重复解析，命中数增加', () => {
    const snap = makeEngine([
      ['A1', '1'],
      ['B1', '=A1+1'],
      ['B2', '=A1+1'],
    ]);
    expect(snap.debug.astCacheSize).toBe(1);
    expect(snap.debug.astCacheHits).toBeGreaterThanOrEqual(1);
  });
});

describe('依赖图快照（特性 27）', () => {
  it('包含 cell/formula/range 节点与边', () => {
    const snap = makeEngine([
      ['A1', '1'],
      ['A2', '2'],
      ['C1', '=SUM(A1:A2)'],
    ]);
    const kinds = snap.graph.nodes.map((n) => n.kind);
    expect(kinds).toContain('cell');
    expect(kinds).toContain('formula');
    expect(kinds).toContain('range');
    // 所有节点都被布局（坐标非全 0）
    const positioned = snap.graph.nodes.some((n) => n.x !== 0 || n.y !== 0);
    expect(positioned).toBe(true);
  });
});
