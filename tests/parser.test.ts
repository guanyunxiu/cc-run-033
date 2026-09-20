import { describe, expect, it } from 'vitest';
import { Parser } from '../src/engine/parser';

function parse(src: string) {
  return Parser.parseFormula(src);
}

describe('Parser 语法分析 / AST', () => {
  it('解析数字与四则运算 AST', () => {
    const { ast, error } = parse('1+2*3');
    expect(error).toBeNull();
    expect(ast).not.toBeNull();
    const tree = ast!;
    expect(tree.type).toBe('binary');
    if (tree.type === 'binary') {
      expect(tree.operator).toBe('+');
      expect(tree.right.type).toBe('binary');
      if (tree.right.type === 'binary') expect(tree.right.operator).toBe('*');
    }
  });

  it('减法左结合、幂右结合', () => {
    const left = parse('10-5-2').ast!;
    expect(left.type).toBe('binary');
    if (left.type === 'binary') {
      expect(left.left.type).toBe('binary'); // (10-5)-2
    }
    const pow = parse('2^3^2').ast!;
    expect(pow.type).toBe('binary');
    if (pow.type === 'binary') {
      expect(pow.right.type).toBe('binary'); // 2^(3^2)
    }
  });

  it('优先级：比较 < 连接 < 加减 < 乘除 < 幂 < 一元', () => {
    const ast = parse('1+2=3&"x"').ast!;
    expect(ast.type).toBe('binary');
    if (ast.type === 'binary') expect(ast.operator).toBe('=');
  });

  it('解析一元正负与百分号后缀', () => {
    const ast = parse('-A1%+2').ast!;
    expect(ast.type).toBe('binary');
    if (ast.type === 'binary') {
      expect(ast.left.type).toBe('unary');
      if (ast.left.type === 'unary') {
        expect(ast.left.operator).toBe('-');
        expect(ast.left.operand.type).toBe('unary');
        if (ast.left.operand.type === 'unary') {
          expect(ast.left.operand.operator).toBe('%');
          expect(ast.left.operand.postfix).toBe(true);
        }
      }
    }
  });

  it('解析函数调用与参数列表', () => {
    const ast = parse('SUM(A1, B2:C3, 4)').ast!;
    expect(ast.type).toBe('function');
    if (ast.type === 'function') {
      expect(ast.name).toBe('SUM');
      expect(ast.args).toHaveLength(3);
      expect(ast.args[1]!.type).toBe('range');
    }
  });

  it('解析区域引用 A1:B10 与绝对引用 $A$1', () => {
    const ast = parse('$A$1:B$10').ast!;
    expect(ast.type).toBe('range');
    if (ast.type === 'range') {
      expect(ast.range.start.col).toBe(0);
      expect(ast.range.start.colAbsolute).toBe(true);
      expect(ast.range.end.rowAbsolute).toBe(true);
    }
  });

  it('解析字符串、布尔与错误字面量', () => {
    expect(parse('"hi"').ast!.type).toBe('string');
    expect(parse('TRUE').ast!.type).toBe('boolean');
    const e = parse('#DIV/0!').ast!;
    expect(e.type).toBe('error');
    if (e.type === 'error') expect(e.code).toBe('#DIV/0!');
  });

  it('括号改变结合性', () => {
    const ast = parse('(1+2)*3').ast!;
    expect(ast.type).toBe('binary');
    if (ast.type === 'binary') {
      expect(ast.operator).toBe('*');
      expect(ast.left.type).toBe('binary');
    }
  });

  it('语法错误定位：缺少右括号', () => {
    const { error } = parse('SUM(1, 2');
    expect(error).not.toBeNull();
    expect(error!.message).toContain('右括号');
  });

  it('语法错误定位：运算符缺右操作数', () => {
    const { error } = parse('1+');
    expect(error).not.toBeNull();
    expect(error!.offset).toBe(2);
  });

  it('语法错误定位：函数参数以逗号开头', () => {
    const { error } = parse('SUM(,1)');
    expect(error).not.toBeNull();
    expect(error!.column).toBeGreaterThan(0);
  });

  it('裸标识符报错', () => {
    const { error } = parse('FOO');
    expect(error!.message).toContain('名称');
  });

  it('空参数列表报错', () => {
    const { error } = parse('SUM(1,,2)');
    expect(error).not.toBeNull();
  });

  it('AST 节点携带位置信息', () => {
    const ast = parse('AB12+3').ast!;
    expect(ast.pos.offset).toBe(0);
    expect(ast.pos.length).toBe(6);
  });
});
