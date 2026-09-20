import { describe, expect, it } from 'vitest';
import { Parser } from '../src/engine/parser';
import { createBuiltinRegistry } from '../src/engine/functions';
import { evaluateAst } from '../src/engine/evaluator';
import { ScalarValue } from '../src/engine/value';
import { Workbook } from '../src/engine/workbook';

const registry = createBuiltinRegistry();

function evalFormula(
  body: string,
  cells: Record<string, ScalarValue> = {},
): ScalarValue {
  const { ast, error } = Parser.parseFormula(body);
  if (error || !ast) throw new Error(`解析失败: ${error?.message}`);
  return evaluateAst(
    ast,
    (col, row) => {
      let s = '';
      let c = col;
      do {
        s = String.fromCharCode(65 + (c % 26)) + s;
        c = Math.floor(c / 26) - 1;
      } while (c >= 0);
      return cells[`${s}${row + 1}`] ?? { kind: 'empty' };
    },
    registry,
  );
}

const num = (v: number): ScalarValue => ({ kind: 'number', value: v });
const txt = (v: string): ScalarValue => ({ kind: 'text', value: v });
const bool = (v: boolean): ScalarValue => ({ kind: 'boolean', value: v });

describe('求值：算术与比较', () => {
  it('四则运算与优先级', () => {
    expect(evalFormula('1+2*3')).toEqual(num(7));
    expect(evalFormula('(1+2)*3')).toEqual(num(9));
    expect(evalFormula('10/4')).toEqual(num(2.5));
    expect(evalFormula('2^3^2')).toEqual(num(512));
    expect(evalFormula('50%')).toEqual(num(0.5));
    expect(evalFormula('-5+2')).toEqual(num(-3));
  });

  it('除零得到 #DIV/0!', () => {
    expect(evalFormula('1/0')).toEqual({ kind: 'error', code: '#DIV/0!' });
  });

  it('文本与数字相加得到 #VALUE!', () => {
    expect(evalFormula('"abc"+1')).toEqual({ kind: 'error', code: '#VALUE!' });
  });

  it('数字文本参与算术时自动转换', () => {
    expect(evalFormula('" 42 "+1')).toEqual(num(43));
  });

  it('比较运算返回布尔', () => {
    expect(evalFormula('1<2')).toEqual(bool(true));
    expect(evalFormula('2<=2')).toEqual(bool(true));
    expect(evalFormula('1<>1')).toEqual(bool(false));
    expect(evalFormula('"a"="a"')).toEqual(bool(true));
  });

  it('文本连接', () => {
    expect(evalFormula('"a"&"b"&123')).toEqual(txt('ab123'));
  });
});

describe('求值：引用', () => {
  it('解析 A1 与 $A$1 引用取值', () => {
    const cells = { A1: num(10), B2: num(20) };
    expect(evalFormula('A1+B2', cells)).toEqual(num(30));
    expect(evalFormula('$A$1*2', cells)).toEqual(num(20));
  });

  it('空引用按 0 / 空文本处理', () => {
    expect(evalFormula('Z99+1')).toEqual(num(1));
    expect(evalFormula('Z99&"x"')).toEqual(txt('x'));
  });
});

describe('求值：函数库', () => {
  const grid = (data: Record<string, number | string | boolean>): Record<string, ScalarValue> => {
    const out: Record<string, ScalarValue> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] =
        typeof v === 'number'
          ? num(v)
          : typeof v === 'boolean'
            ? bool(v)
            : txt(v);
    }
    return out;
  };

  it('SUM 忽略文本与空单元格', () => {
    const cells = grid({ A1: 1, A2: 2, A3: 'hello', B1: 10 });
    expect(evalFormula('SUM(A1:B1)', cells)).toEqual(num(11));
    expect(evalFormula('SUM(A1:A3)', cells)).toEqual(num(3));
  });

  it('AVERAGE 与无数字时 #DIV/0!', () => {
    const cells = grid({ A1: 2, A2: 4, A3: 'x' });
    expect(evalFormula('AVERAGE(A1:A3)', cells)).toEqual(num(3));
    expect(evalFormula('AVERAGE(A3:A3)', cells)).toEqual({
      kind: 'error',
      code: '#DIV/0!',
    });
  });

  it('MIN / MAX', () => {
    const cells = grid({ A1: 3, A2: -1, A3: 9 });
    expect(evalFormula('MIN(A1:A3)', cells)).toEqual(num(-1));
    expect(evalFormula('MAX(A1:A3)', cells)).toEqual(num(9));
  });

  it('ROUND 四舍五入（远离零）', () => {
    expect(evalFormula('ROUND(2.5,0)')).toEqual(num(3));
    expect(evalFormula('ROUND(2.45,1)')).toEqual(num(2.5));
    expect(evalFormula('ROUND(-2.5,0)')).toEqual(num(-3));
  });

  it('ABS', () => {
    expect(evalFormula('ABS(-7)')).toEqual(num(7));
  });

  it('IF 惰性求值：未选中的分支即使有错误也不传播', () => {
    expect(evalFormula('IF(1>0, "yes", 1/0)')).toEqual(txt('yes'));
    expect(evalFormula('IF(FALSE, 1/0, "ok")')).toEqual(txt('ok'));
    expect(evalFormula('IF(A1>=10, "大", "小")', { A1: num(20) })).toEqual(txt('大'));
  });

  it('AND / OR / NOT', () => {
    const cells = grid({ A1: 1, A2: 0 });
    expect(evalFormula('AND(TRUE, A1>A2)', cells)).toEqual(bool(true));
    expect(evalFormula('AND(TRUE, FALSE)')).toEqual(bool(false));
    expect(evalFormula('OR(FALSE, A1<A2)', cells)).toEqual(bool(false));
    expect(evalFormula('NOT(FALSE)')).toEqual(bool(true));
  });

  it('COUNT / COUNTA', () => {
    const cells = grid({ A1: 1, A2: 'x', A3: 3, A4: true });
    expect(evalFormula('COUNT(A1:A4)', cells)).toEqual(num(2));
    expect(evalFormula('COUNTA(A1:A4)', cells)).toEqual(num(4));
  });

  it('未知函数 -> #NAME?，参数数量错误 -> #N/A', () => {
    expect(evalFormula('FOO(1)')).toEqual({ kind: 'error', code: '#NAME?' });
    expect(evalFormula('ABS()')).toEqual({ kind: 'error', code: '#N/A' });
    expect(evalFormula('SUM()')).toEqual({ kind: 'error', code: '#N/A' });
  });
});

describe('求值：错误传播（特性 26）', () => {
  it('错误操作数沿算术传播', () => {
    const cells = { A1: { kind: 'error', code: '#DIV/0!' } as ScalarValue };
    expect(evalFormula('A1+1', cells)).toEqual({ kind: 'error', code: '#DIV/0!' });
  });

  it('错误字面量参与函数', () => {
    expect(evalFormula('SUM(#N/A, 1)')).toEqual({ kind: 'error', code: '#N/A' });
  });

  it('区域内的错误沿 SUM 传播', () => {
    const cells: Record<string, ScalarValue> = {
      A1: num(1),
      A2: { kind: 'error', code: '#VALUE!' },
    };
    expect(evalFormula('SUM(A1:A2)', cells)).toEqual({
      kind: 'error',
      code: '#VALUE!',
    });
  });
});

describe('Workbook 端到端求值与字面值解析', () => {
  it('字面值类型：数字、文本、布尔、空、错误', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '42');
    wb.setCell(1, 0, 'hello');
    wb.setCell(2, 0, 'TRUE');
    wb.setCell(3, 0, '#N/A');
    wb.setCell(4, 0, '');
    const r = wb.recalc();
    expect(r.cells.get('A1')!.value).toEqual(num(42));
    expect(r.cells.get('B1')!.value).toEqual(txt('hello'));
    expect(r.cells.get('C1')!.value).toEqual(bool(true));
    expect(r.cells.get('D1')!.value).toEqual({ kind: 'error', code: '#N/A' });
  });

  it('多级公式按依赖顺序重算', () => {
    const wb = new Workbook();
    wb.setCell(0, 0, '2');
    wb.setCell(1, 0, '3');
    wb.setCell(2, 0, '=A1+B1');
    wb.setCell(3, 0, '=C1*2');
    wb.setCell(4, 0, '=SUM(A1:D1)');
    const r = wb.recalc();
    expect(r.cells.get('C1')!.value).toEqual(num(5));
    expect(r.cells.get('D1')!.value).toEqual(num(10));
    expect(r.cells.get('E1')!.value).toEqual(num(20));
    // 顺序：C1 在 D1 之前，D1 在 E1 之前
    const keys = r.order.map((o) => o.key);
    expect(keys.indexOf('C1')).toBeLessThan(keys.indexOf('D1'));
    expect(keys.indexOf('D1')).toBeLessThan(keys.indexOf('E1'));
  });
});
