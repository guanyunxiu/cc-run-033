import { describe, expect, it } from 'vitest';
import { Parser } from '../src/engine/parser';
import { extractDependencies } from '../src/engine/dependencies';
import { Workbook } from '../src/engine/workbook';
import { cellId, formulaId, rangeId } from '../src/engine/graph';
import { parseRange } from '../src/engine/a1';

function depsOf(body: string) {
  const { ast, error } = Parser.parseFormula(body);
  if (error || !ast) throw new Error(error?.message);
  return extractDependencies(ast);
}

describe('从 AST 提取依赖（特性 19）', () => {
  it('提取单个引用并去重', () => {
    const d = depsOf('A1+B1+A1');
    expect(d.cells.map((c) => `${c.col},${c.row}`).sort()).toEqual(['0,0', '1,0']);
  });

  it('提取区域引用', () => {
    const d = depsOf('SUM(A1:B10)+C3');
    expect(d.ranges).toHaveLength(1);
    expect(d.ranges[0]!.start).toMatchObject({ col: 0, row: 0 });
    expect(d.ranges[0]!.end).toMatchObject({ col: 1, row: 9 });
    expect(d.cells.map((c) => `${c.col},${c.row}`)).toEqual(['2,2']);
  });

  it('嵌套函数与表达式中的依赖', () => {
    const d = depsOf('IF(SUM(A1:A3)>B1, C1, D1)');
    expect(d.ranges).toHaveLength(1);
    expect(d.cells).toHaveLength(3);
  });

  it('无引用的常量公式', () => {
    expect(depsOf('1+2').cells).toHaveLength(0);
  });
});

describe('依赖图结构（特性 16/17/18）', () => {
  it('构建 cell/formula/range 三类节点与邻接表、逆邻接表', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '1');
    wb.setCell(1, 0, '2');
    wb.setCell(2, 0, '=SUM(A1:B1)+A1');
    const r = wb.recalc();
    const g = r.graph;

    expect(g.nodes.has(cellId({ col: 2, row: 0 }))).toBe(true);
    expect(g.nodes.has(formulaId({ col: 2, row: 0 }))).toBe(true);
    const rgId = rangeId('C1', parseRange('A1:B1')!);
    expect(g.nodes.has(rgId)).toBe(true);

    // cell C1 -> formula C1（owns）
    expect(g.out.get(cellId({ col: 2, row: 0 }))!).toContain(formulaId({ col: 2, row: 0 }));
    // 逆邻接表：formula C1 <- cell C1
    expect(g.incoming.get(formulaId({ col: 2, row: 0 }))!).toContain(
      cellId({ col: 2, row: 0 }),
    );
    // range -> A1 / B1（covers）
    expect(g.out.get(rgId)!).toContain(cellId({ col: 0, row: 0 }));
    expect(g.out.get(rgId)!).toContain(cellId({ col: 1, row: 0 }));
  });

  it('上游 / 下游 BFS 可达集合（特性 29）', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '1');
    wb.setCell(1, 0, '=A1+1');
    wb.setCell(2, 0, '=B1+1');
    const r = wb.recalc();
    const g = r.graph;
    // B1 的上游含 A1；下游含 C1 相关节点
    const bUp = g.upstreamOf(formulaId({ col: 1, row: 0 }));
    expect(bUp.has(cellId({ col: 0, row: 0 }))).toBe(true);
    const aDown = g.downstreamOf(cellId({ col: 0, row: 0 }));
    expect(aDown.has(cellId({ col: 2, row: 0 }))).toBe(true);
  });

  it('压缩单元格图的边只含 cell -> cell', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '1');
    wb.setCell(1, 0, '=SUM(A1:A1)');
    const { out } = wb.recalc().graph.compressedCellEdges();
    const edges = [...out.get(cellId({ col: 1, row: 0 }))!];
    expect(edges).toEqual([cellId({ col: 0, row: 0 })]);
  });
});
