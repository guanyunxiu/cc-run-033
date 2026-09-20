/**
 * 地址与区域、依赖提取测试（特性 6、7、13、14、19）。
 */
import { describe, expect, it } from 'vitest';
import {
  colToLetters,
  lettersToCol,
  parseRef,
  normalizeRect,
  expandRect,
  formatAddr,
} from '../src/core/address.js';
import { extractDependencies, extractRanges } from '../src/core/dependencies.js';
import { parseFormula } from '../src/core/parser.js';
import { AstCache } from '../src/core/ast-cache.js';

describe('地址格式（特性 6）', () => {
  it('列号 <-> 字母', () => {
    expect(colToLetters(0)).toBe('A');
    expect(colToLetters(25)).toBe('Z');
    expect(colToLetters(26)).toBe('AA');
    expect(lettersToCol('A')).toBe(0);
    expect(lettersToCol('Z')).toBe(25);
    expect(lettersToCol('AA')).toBe(26);
  });

  it('parseRef 解析 A1 与 $A$1', () => {
    expect(parseRef('B3')).toMatchObject({ col: 1, row: 2, absoluteCol: false, absoluteRow: false });
    expect(parseRef('$B$3')).toMatchObject({ col: 1, row: 2, absoluteCol: true, absoluteRow: true });
    expect(parseRef('B$3')).toMatchObject({ absoluteCol: false, absoluteRow: true });
  });

  it('非法引用抛错', () => {
    expect(() => parseRef('12A')).toThrow();
  });

  it('formatAddr', () => {
    expect(formatAddr({ row: 0, col: 0 })).toBe('A1');
    expect(formatAddr({ row: 9, col: 1 })).toBe('B10');
  });
});

describe('区域引用与展开（特性 7、14）', () => {
  it('归一化反向区域', () => {
    const rect = normalizeRect({ row: 9, col: 1 }, { row: 0, col: 0 });
    expect(rect).toEqual({ top: 0, left: 0, bottom: 9, right: 1 });
  });

  it('展开 2x2 区域', () => {
    const cells = expandRect({ top: 0, left: 0, bottom: 1, right: 1 });
    expect(cells).toHaveLength(4);
  });
});

describe('从 AST 提取依赖（特性 19）', () => {
  it('提取标量引用并去重', () => {
    const ast = parseFormula('A1+A1+B2');
    const deps = extractDependencies(ast);
    const addrs = deps.map((d) => formatAddr(d.addr));
    expect(addrs.sort()).toEqual(['A1', 'B2']);
  });

  it('区域展开为成员依赖并带来源标记', () => {
    const ast = parseFormula('SUM(A1:B2)');
    const deps = extractDependencies(ast);
    expect(deps).toHaveLength(4);
    expect(deps.every((d) => d.source === 'range')).toBe(true);
    expect(deps[0]!.range).toBe('A1:B2');
  });

  it('提取区域节点（不展开）', () => {
    const ast = parseFormula('SUM(A1:B2)+C3');
    const ranges = extractRanges(ast);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.label).toBe('A1:B2');
  });

  it('嵌套函数中的引用全部被收集', () => {
    const ast = parseFormula('IF(A1>0,SUM(B1:B2),MAX(C1,C2))');
    const deps = extractDependencies(ast).map((d) => formatAddr(d.addr));
    expect(deps.sort()).toEqual(['A1', 'B1', 'B2', 'C1', 'C2']);
  });
});

describe('AST 缓存（技术 10）', () => {
  it('命中缓存返回同一结果', () => {
    const cache = new AstCache();
    const a = cache.get('=1+2');
    const b = cache.get('=1+2');
    expect(a.ast).toBe(b.ast);
    expect(cache.hitCount).toBe(1);
  });

  it('缓存解析错误', () => {
    const cache = new AstCache();
    expect(cache.get('=1+').error).toBeDefined();
    expect(cache.get('=1+').error).toBeDefined();
  });
});
