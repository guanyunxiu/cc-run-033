/**
 * 电子表格错误值（特性 25）。
 * 错误值是“一等公民”，会在单元格之间传播（特性 26）。
 */
export type ErrorCode =
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#N/A'
  | '#CYCLE!';

export const ALL_ERROR_CODES: readonly ErrorCode[] = [
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#N/A',
  '#CYCLE!',
];

export class EvalError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'EvalError';
    this.code = code;
  }
}

export function isErrorCode(text: string): text is ErrorCode {
  return (
    text === '#DIV/0!' ||
    text === '#VALUE!' ||
    text === '#REF!' ||
    text === '#NAME?' ||
    text === '#N/A' ||
    text === '#CYCLE!'
  );
}

export function errorMessage(code: ErrorCode): string {
  switch (code) {
    case '#DIV/0!':
      return '除数为零';
    case '#VALUE!':
      return '参数或操作数类型错误';
    case '#REF!':
      return '引用无效';
    case '#NAME?':
      return '无法识别的函数或名称';
    case '#N/A':
      return '值当前不可用';
    case '#CYCLE!':
      return '循环引用：公式直接或间接引用了自身';
  }
}
