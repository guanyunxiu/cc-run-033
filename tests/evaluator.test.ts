/**
 * 求值测试（技术 25，特性 5、15、25、26）。
 */
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/evaluator.js';
import { parseFormula } from '../src/core/parser.js';
import type { CellValue } from '../src/core/types.js';

function eval_(
  formula: string,
  cells: Record<string, CellValue> = {},
  maxRow = 50,
  maxCol = 10,
): CellValue {
  const ast = parseFormula(formula);
  return evaluate(
    ast,
    {
      getCell: (row, col) => {
        const key = `${String.fromCharCode(65 + col)}${row + 1}`;
        return cells[key] ?? { type: 'empty' };
      },
    },
    { maxRow, maxCol },
  );
}

describe('字面量与运算', () => {
  it('算术四则', () => {
    expect(eval_('1+2*3')).toEqual({ type: 'number', value: 7 });
    expect(eval_('(1+2)*3')).toEqual({ type: 'number', value: 9 });
    expect(eval_('10/4')).toEqual({ type: 'number', value: 2.5 });
    expect(eval_('2^10')).toEqual({ type: 'number', value: 1024 });
  });

  it('一元与百分号', () => {
    expect(eval_('-5')).toEqual({ type: 'number', value: -5 });
    expect(eval_('50%')).toEqual({ type: 'number', value: 0.5 });
    expect(eval_('-50%')).toEqual({ type: 'number', value: -0.5 });
  });

  it('字符串拼接', () => {
    expect(eval_('"a"&"b"')).toEqual({ type: 'text', value: 'ab' });
    expect(eval_('1&2')).toEqual({ type: 'text', value: '12' });
  });

  it('比较运算返回布尔', () => {
    expect(eval_('1<2')).toEqual({ type: 'boolean', value: true });
    expect(eval_('2<=2')).toEqual({ type: 'boolean', value: true });
    expect(eval_('"a"="a"')).toEqual({ type: 'boolean', value: true });
    expect(eval_('1<>2')).toEqual({ type: 'boolean', value: true });
  });
});

describe('内置函数（特性 15）', () => {
  it('SUM 区域求和，忽略文本', () => {
    const v = eval_('=SUM(A1:A3)', {
      A1: { type: 'number', value: 1 },
      A2: { type: 'text', value: 'x' },
      A3: { type: 'number', value: 4 },
    });
    expect(v).toEqual({ type: 'number', value: 5 });
  });

  it('AVERAGE 与 #DIV/0!', () => {
    expect(eval_('AVERAGE(A1:A3)', { A1: { type: 'number', value: 2 }, A2: { type: 'number', value: 4 }, A3: { type: 'empty' } })).toEqual({ type: 'number', value: 3 });
    const e = eval_('AVERAGE(A1:A2)', { A1: { type: 'empty' }, A2: { type: 'text', value: 'x' } });
    expect(e.type).toBe('error');
    if (e.type === 'error') expect(e.kind).toBe('#DIV/0!');
  });

  it('MIN / MAX / COUNT / COUNTA', () => {
    const data = {
      A1: { type: 'number', value: 3 } as CellValue,
      A2: { type: 'number', value: 9 } as CellValue,
      A3: { type: 'text', value: 'x' } as CellValue,
      A4: { type: 'empty' } as CellValue,
    };
    expect(eval_('MIN(A1:A4)', data)).toEqual({ type: 'number', value: 3 });
    expect(eval_('MAX(A1:A4)', data)).toEqual({ type: 'number', value: 9 });
    expect(eval_('COUNT(A1:A4)', data)).toEqual({ type: 'number', value: 2 });
    expect(eval_('COUNTA(A1:A4)', data)).toEqual({ type: 'number', value: 3 });
    expect(eval_('MAX(A1)', { A1: { type: 'empty' } })).toEqual({ type: 'number', value: 0 });
  });

  it('ROUND / ABS', () => {
    expect(eval_('ROUND(3.14159,2)')).toEqual({ type: 'number', value: 3.14 });
    expect(eval_('ROUND(3.5,0)')).toEqual({ type: 'number', value: 4 });
    expect(eval_('ABS(-7)')).toEqual({ type: 'number', value: 7 });
  });

  it('IF 条件与惰性求值', () => {
    expect(eval_('IF(1>0,"yes","no")')).toEqual({ type: 'text', value: 'yes' });
    expect(eval_('IF(FALSE,1/0,42)')).toEqual({ type: 'number', value: 42 });
  });

  it('AND / OR / NOT', () => {
    expect(eval_('AND(TRUE,TRUE,1)')).toEqual({ type: 'boolean', value: true });
    expect(eval_('AND(TRUE,FALSE)')).toEqual({ type: 'boolean', value: false });
    expect(eval_('OR(FALSE,FALSE,1)')).toEqual({ type: 'boolean', value: true });
    expect(eval_('NOT(1=2)')).toEqual({ type: 'boolean', value: true });
    expect(eval_('AND("x",1)').type).toBe('error');
  });

  it('参数个数校验 => #N/A', () => {
    const e = eval_('ABS(1,2)');
    expect(e.type).toBe('error');
    if (e.type === 'error') expect(e.kind).toBe('#N/A');
  });
});

describe('错误类型与传播（特性 25、26）', () => {
  it('除零 #DIV/0!', () => {
    const v = eval_('1/0');
    expect(v.type).toBe('error');
    if (v.type === 'error') expect(v.kind).toBe('#DIV/0!');
  });

  it('文本参与算术 #VALUE!', () => {
    const v = eval_('"abc"+1');
    expect(v.type).toBe('error');
    if (v.type === 'error') expect(v.kind).toBe('#VALUE!');
  });

  it('未知函数 #NAME?', () => {
    const v = eval_('BOGUS(1)');
    expect(v.type).toBe('error');
    if (v.type === 'error') expect(v.kind).toBe('#NAME?');
  });

  it('越界引用 #REF!', () => {
    const v = eval_('Z99', {}, 5, 5);
    expect(v.type).toBe('error');
    if (v.type === 'error') expect(v.kind).toBe('#REF!');
  });

  it('错误值参与后续计算时继续传播', () => {
    const v = eval_('(1/0)+100');
    expect(v.type).toBe('error');
    if (v.type === 'error') expect(v.kind).toBe('#DIV/0!');
  });

  it('引用错误单元格向上传播', () => {
    const v = eval_('A1+1', { A1: { type: 'error', kind: '#NAME?' } });
    expect(v.type).toBe('error');
    if (v.type === 'error') expect(v.kind).toBe('#NAME?');
  });
});
