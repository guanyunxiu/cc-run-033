import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/engine/workbook';

describe('循环引用端到端（特性 23、24）', () => {
  it('自引用循环显示 #CYCLE!', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '10');
    wb.setCell(1, 0, '=B1+1'); // B1 引用自身
    const r = wb.recalc();
    expect(r.cells.get('B1')!.value).toEqual({ kind: 'error', code: '#CYCLE!' });
    expect(r.cells.get('B1')!.cyclic).toBe(true);
    expect(r.cycles.some((c) => c.kind === 'self')).toBe(true);
  });

  it('区域包含自身也算自引用循环', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '1');
    wb.setCell(1, 0, '2');
    wb.setCell(2, 0, '=SUM(A1:C1)'); // C1 的区域覆盖自身
    const r = wb.recalc();
    expect(r.cells.get('C1')!.value).toEqual({ kind: 'error', code: '#CYCLE!' });
    expect(r.cycles.some((c) => c.kind === 'self')).toBe(true);
  });

  it('直接循环：两格互相引用', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '=B1+1');
    wb.setCell(1, 0, '=A1+1');
    const r = wb.recalc();
    expect(r.cells.get('A1')!.value).toEqual({ kind: 'error', code: '#CYCLE!' });
    expect(r.cells.get('B1')!.value).toEqual({ kind: 'error', code: '#CYCLE!' });
    expect(r.cycles.some((c) => c.kind === 'direct')).toBe(true);
  });

  it('间接循环：A->B->C->A', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '=B1+1');
    wb.setCell(1, 0, '=C1+1');
    wb.setCell(2, 0, '=A1+1');
    const r = wb.recalc();
    for (const k of ['A1', 'B1', 'C1']) {
      expect(r.cells.get(k)!.value).toEqual({ kind: 'error', code: '#CYCLE!' });
    }
    expect(r.cycles.some((c) => c.kind === 'indirect')).toBe(true);
  });

  it('循环节点的下游正常求值并传播（读到 #CYCLE! 当作错误传播）', () => {
    const wb = new Workbook();
    wb.setCell(1, 0, '=B1+1'); // B1 自引用
    wb.setCell(2, 0, '=B1*2'); // C1 下游
    const r = wb.recalc();
    expect(r.cells.get('C1')!.value).toEqual({ kind: 'error', code: '#CYCLE!' });
    // 重算顺序里循环节点带 cycle 标记
    const cycleEntries = r.order.filter((o) => o.kind === 'cycle');
    expect(cycleEntries.map((o) => o.key)).toContain('B1');
  });

  it('DFS 算法与 Kahn 算法对循环的结论一致', () => {
    const make = (): Workbook => {
      const wb = new Workbook();
      wb.setCell(0, 0, '=B1+1');
      wb.setCell(1, 0, '=A1+1');
      wb.setCell(2, 0, '=C1+A1');
      wb.setCell(3, 0, '5');
      return wb;
    };
    const k = make().recalc();
    const wb2 = make();
    wb2.setAlgorithm('dfs');
    const d = wb2.recalc();
    expect([...k.cycles[0]!.members].sort()).toEqual([...d.cycles[0]!.members].sort());
    expect(k.cells.get('D1')!.value).toEqual({ kind: 'number', value: 5 });
    expect(d.cells.get('D1')!.value).toEqual({ kind: 'number', value: 5 });
  });
});
