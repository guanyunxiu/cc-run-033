import type { ErrorCode } from './errors';

/**
 * 单元格值（特性 5：数字、文本、布尔、空值、错误；公式求值后得到以上类型）。
 */
export type ScalarValue =
  | { kind: 'empty' }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; code: ErrorCode };

export const EMPTY: ScalarValue = { kind: 'empty' };
export const num = (value: number): ScalarValue => ({ kind: 'number', value });
export const txt = (value: string): ScalarValue => ({ kind: 'text', value });
export const bool = (value: boolean): ScalarValue => ({ kind: 'boolean', value });
export const errVal = (code: ErrorCode): ScalarValue => ({ kind: 'error', code });

export function isError(v: ScalarValue): v is { kind: 'error'; code: ErrorCode } {
  return v.kind === 'error';
}

/** 数字转显示文本；整数不带小数点，避免浮点尾巴（0.1 + 0.2 仍然显示 0.30000000000000004，与 Excel 一致由调用方决定精度策略）。 */
export function formatValue(v: ScalarValue): string {
  switch (v.kind) {
    case 'empty':
      return '';
    case 'number':
      if (!Number.isFinite(v.value)) return '#VALUE!';
      return String(v.value);
    case 'text':
      return v.value;
    case 'boolean':
      return v.value ? 'TRUE' : 'FALSE';
    case 'error':
      return v.code;
  }
}

/** 值的粗粒度类型名，用于调试面板与函数参数校验。 */
export type ValueTypeName = 'number' | 'text' | 'boolean' | 'empty' | 'error';

export function valueType(v: ScalarValue): ValueTypeName {
  return v.kind;
}
