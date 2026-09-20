import { describe, expect, it } from 'vitest';
import { Lexer } from '../src/engine/lexer';

describe('Lexer 词法分析', () => {
  it('识别数字、运算符与括号', () => {
    const { tokens, error } = Lexer.tokenize('1+2.5*(3-4)');
    expect(error).toBeNull();
    expect(tokens.map((t) => t.type)).toEqual([
      'number', 'plus', 'number', 'star', 'lparen',
      'number', 'minus', 'number', 'rparen', 'eof',
    ]);
  });

  it('识别科学计数法与百分号、幂', () => {
    const { tokens } = Lexer.tokenize('1.5e3%^2');
    expect(tokens.map((t) => t.type)).toEqual([
      'number', 'percent', 'caret', 'number', 'eof',
    ]);
  });

  it('识别字符串字面量与转义引号', () => {
    const { tokens } = Lexer.tokenize('"a""b" & "c"');
    expect(tokens[0]!.value).toBe('a"b');
    expect(tokens.map((t) => t.type)).toEqual([
      'string', 'ampersand', 'string', 'eof',
    ]);
  });

  it('识别 A1 与 $A$1 四种引用形式', () => {
    for (const text of ['A1', '$A$1', '$A1', 'A$1']) {
      const { tokens } = Lexer.tokenize(text);
      expect(tokens[0]!.type).toBe('reference');
      expect(tokens[0]!.text).toBe(text);
    }
  });

  it('识别布尔、函数名与错误字面量', () => {
    const { tokens } = Lexer.tokenize('IF(TRUE, #N/A, FALSE)');
    expect(tokens.map((t) => t.type)).toEqual([
      'name', 'lparen', 'boolean', 'comma', 'error', 'comma', 'boolean', 'rparen', 'eof',
    ]);
  });

  it('识别全部比较运算符', () => {
    const { tokens } = Lexer.tokenize('=<><<=>>=');
    expect(tokens.map((t) => t.type)).toEqual([
      'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'eof',
    ]);
  });

  it('跳过空白并保留偏移位置', () => {
    const { tokens } = Lexer.tokenize('  A1 + 2');
    const ref = tokens[0]!;
    expect(ref.offset).toBe(2);
    expect(ref.column).toBe(3);
  });

  it('未闭合字符串返回词法错误及位置', () => {
    const { error } = Lexer.tokenize('"abc');
    expect(error).not.toBeNull();
    expect(error!.offset).toBe(0);
  });

  it('非法字符报错', () => {
    const { error } = Lexer.tokenize('1 @ 2');
    expect(error!.message).toContain('@');
  });

  it('区域冒号作为独立 token', () => {
    const { tokens } = Lexer.tokenize('A1:B10');
    expect(tokens.map((t) => t.type)).toEqual([
      'reference', 'colon', 'reference', 'eof',
    ]);
  });
});
