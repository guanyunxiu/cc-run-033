/**
 * 词法/语法分析测试（技术 24：公式解析测试，特性 8-11）。
 */
import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/core/lexer.js';
import { parseFormula } from '../src/core/parser.js';
import { FormulaError } from '../src/core/types.js';

describe('lexer 词法分析', () => {
  it('token 化数字、运算符与括号', () => {
    const tokens = tokenize('1+2*3');
    expect(tokens.map((t) => t.type)).toEqual([
      'number',
      'op',
      'number',
      'op',
      'number',
      'eof',
    ]);
  });

  it('识别 A1 与 $A$1 引用', () => {
    expect(tokenize('A1')[0]!.type).toBe('ref');
    expect(tokenize('$A$1')[0]!.type).toBe('ref');
    expect(tokenize('B$2')[0]!.type).toBe('ref');
    expect(tokenize('$Z10')[0]!.type).toBe('ref');
  });

  it('识别多字符比较运算符', () => {
    const types = tokenize('a<=b>=c<>d').map((t) => t.type);
    expect(types.filter((t) => t === 'op')).toHaveLength(3);
  });

  it('识别字符串与转义引号', () => {
    const t = tokenize('"say ""hi"""')[0]!;
    expect(t.type).toBe('string');
    expect(t.value).toBe('"say ""hi"""');
  });

  it('识别 TRUE/FALSE 与函数名', () => {
    expect(tokenize('TRUE')[0]!.type).toBe('bool');
    expect(tokenize('SUM')[0]!.type).toBe('ident');
  });

  it('对非法字符抛错并携带定位', () => {
    expect(() => tokenize('1 @ 2')).toThrow(FormulaError);
    try {
      tokenize('1 @ 2');
    } catch (e) {
      expect((e as FormulaError).offset).toBe(2);
    }
  });

  it('未闭合字符串抛错', () => {
    expect(() => tokenize('"abc')).toThrow(/引号/);
  });
});

describe('parser 语法分析 + AST', () => {
  it('数字字面量', () => {
    expect(parseFormula('42')).toEqual({
      kind: 'number',
      value: 42,
      pos: { start: 0, end: 2 },
    });
  });

  it('优先级：1+2*3 中乘法优先', () => {
    const ast = parseFormula('1+2*3');
    expect(ast.kind).toBe('binary');
    if (ast.kind === 'binary') {
      expect(ast.operator).toBe('+');
      expect(ast.right.kind).toBe('binary');
    }
  });

  it('括号改变结合顺序', () => {
    const ast = parseFormula('(1+2)*3');
    expect(ast.kind).toBe('binary');
    if (ast.kind === 'binary') {
      expect(ast.operator).toBe('*');
      expect(ast.left.kind).toBe('binary');
    }
  });

  it('幂运算右结合', () => {
    const ast = parseFormula('2^3^2');
    expect(ast.kind).toBe('binary');
    if (ast.kind === 'binary') {
      expect(ast.right.kind).toBe('binary');
      if (ast.right.kind === 'binary') expect(ast.right.operator).toBe('^');
    }
  });

  it('一元负号与百分号', () => {
    expect(parseFormula('-5').kind).toBe('unary');
    expect(parseFormula('50%').kind).toBe('percent');
    expect(parseFormula('-A1%').kind).toBe('unary');
  });

  it('解析区域引用 A1:B10', () => {
    const ast = parseFormula('SUM(A1:B10)');
    expect(ast.kind).toBe('function');
    if (ast.kind === 'function') {
      expect(ast.name).toBe('SUM');
      expect(ast.args[0]!.kind).toBe('range');
      if (ast.args[0]!.kind === 'range') {
        expect(ast.args[0]!.start.row).toBe(0);
        expect(ast.args[0]!.end.col).toBe(1);
        expect(ast.args[0]!.end.row).toBe(9);
      }
    }
  });

  it('解析 $A$1 绝对引用标记', () => {
    const ast = parseFormula('$A$1+1');
    if (ast.kind === 'binary' && ast.left.kind === 'ref') {
      expect(ast.left.absoluteCol).toBe(true);
      expect(ast.left.absoluteRow).toBe(true);
    } else {
      throw new Error('期望 binary + ref');
    }
  });

  it('函数多参数与嵌套', () => {
    const ast = parseFormula('IF(A1>0,SUM(B1:B3),MAX(C1,C2))');
    expect(ast.kind).toBe('function');
    if (ast.kind === 'function') {
      expect(ast.args).toHaveLength(3);
      expect(ast.args[1]!.kind).toBe('function');
    }
  });

  it('裸标识符产生 nameError 节点（求值阶段 #NAME?）', () => {
    expect(parseFormula('FOO').kind).toBe('nameError');
  });

  it('语法错误定位：缺少右括号', () => {
    try {
      parseFormula('SUM(1,2');
      throw new Error('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError);
      const fe = e as FormulaError;
      expect(fe.offset).toBeGreaterThanOrEqual(0);
      expect(fe.length).toBeGreaterThan(0);
    }
  });

  it('语法错误定位：多余运算符', () => {
    expect(() => parseFormula('1+')).toThrow(FormulaError);
    expect(() => parseFormula('1**2')).toThrow(FormulaError);
    expect(() => parseFormula('(1+2')).toThrow(FormulaError);
  });

  it('每个 AST 节点带 pos 位置', () => {
    const ast = parseFormula('1+SUM(A1)');
    const check = (n: typeof ast): void => {
      expect(n.pos.start).toBeGreaterThanOrEqual(0);
      expect(n.pos.end).toBeGreaterThan(n.pos.start);
      if (n.kind === 'binary') {
        check(n.left);
        check(n.right);
      }
      if (n.kind === 'function') n.args.forEach(check);
    };
    check(ast);
  });
});
