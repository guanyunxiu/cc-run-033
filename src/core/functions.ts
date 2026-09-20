/**
 * 函数注册表（技术 13）+ 函数签名与参数校验（技术 14）。
 *
 * 内置函数库（特性 15）：
 * SUM、AVERAGE、MIN、MAX、ROUND、ABS、IF、AND、OR、NOT、COUNT、COUNTA
 */
import { EMPTY, err, type CellValue } from './types.js';

/** 求值上下文：函数需要读取区域单元格时通过它访问 */
export interface EvalContext {
  getCell(row: number, col: number): CellValue;
}

/** 参数可以是标量值或区域展开的数组 */
export type ArgValue = CellValue | CellValue[];

export interface FunctionSignature {
  name: string;
  /** 参数个数：-1 表示可变参数；两元素表示 [min,max] */
  arity: number | readonly [number, number];
  /** 是否对参数做惰性求值（IF 需要） */
  lazy?: boolean;
  description: string;
}

export type FunctionImpl = (args: ArgValue[], ctx: EvalContext) => CellValue;

export interface RegisteredFunction {
  signature: FunctionSignature;
  impl: FunctionImpl;
}

function validateArity(sig: FunctionSignature, count: number): CellValue | null {
  if (sig.arity === -1) {
    if (count === 0) return err('#N/A', `函数 ${sig.name} 至少需要 1 个参数`);
    return null;
  }
  if (typeof sig.arity === 'number') {
    if (count !== sig.arity) {
      return err('#N/A', `函数 ${sig.name} 需要 ${sig.arity} 个参数，但得到 ${count} 个`);
    }
    return null;
  }
  const [min, max] = sig.arity;
  if (count < min || count > max) {
    return err(
      '#N/A',
      `函数 ${sig.name} 需要 ${min}~${max} 个参数，但得到 ${count} 个`,
    );
  }
  return null;
}

// --- 工具：扁平化参数为标量序列 -------------------------------------------

function flatten(args: ArgValue[]): CellValue[] {
  const out: CellValue[] = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a);
    else out.push(a);
  }
  return out;
}

/** 数组 + 标量（忽略空单元格） */
function numericValues(args: ArgValue[]): number[] {
  const nums: number[] = [];
  for (const v of flatten(args)) {
    if (v.type === 'number') nums.push(v.value);
    else if (v.type === 'boolean') nums.push(v.value ? 1 : 0);
    // text / empty 被 SUM 等忽略；错误在调用前已传播
  }
  return nums;
}

// --- 内置函数实现 -----------------------------------------------------------

const sumImpl: FunctionImpl = (args) => {
  const nums = numericValues(args);
  return { type: 'number', value: nums.reduce((a, b) => a + b, 0) };
};

const averageImpl: FunctionImpl = (args) => {
  const nums = numericValues(args);
  if (nums.length === 0) return err('#DIV/0!', 'AVERAGE 的参数中没有数值');
  return { type: 'number', value: nums.reduce((a, b) => a + b, 0) / nums.length };
};

const minImpl: FunctionImpl = (args) => {
  const nums = numericValues(args);
  return { type: 'number', value: nums.length === 0 ? 0 : Math.min(...nums) };
};

const maxImpl: FunctionImpl = (args) => {
  const nums = numericValues(args);
  return { type: 'number', value: nums.length === 0 ? 0 : Math.max(...nums) };
};

const roundImpl: FunctionImpl = (args) => {
  const flat = flatten(args);
  const v = flat[0] ?? EMPTY;
  const d = flat[1] ?? EMPTY;
  if (v.type !== 'number' || d.type !== 'number') {
    return err('#VALUE!', 'ROUND 需要两个数字参数');
  }
  const digits = d.value;
  const factor = 10 ** digits;
  return { type: 'number', value: Math.round(v.value * factor) / factor };
};

const absImpl: FunctionImpl = (args) => {
  const v = flatten(args)[0] ?? EMPTY;
  if (v.type !== 'number') return err('#VALUE!', 'ABS 需要数字参数');
  return { type: 'number', value: Math.abs(v.value) };
};

const ifImpl: FunctionImpl = (args) => {
  // IF 为惰性求值：参数传入的是已经被求值的结果（求值器对 IF 特判）
  const cond = args[0];
  const scalarCond = Array.isArray(cond) ? (cond[0] ?? EMPTY) : cond;
  if (scalarCond.type === 'error') return scalarCond;
  const truthy = scalarCond.type === 'boolean' ? scalarCond.value : scalarCond.type === 'number';
  const whenTrue = args[1];
  const whenFalse = args[2] ?? { type: 'boolean', value: false } satisfies CellValue;
  const pick = truthy ? whenTrue : whenFalse;
  return Array.isArray(pick) ? (pick[0] ?? EMPTY) : pick;
};

function toLogical(v: CellValue): boolean | null {
  if (v.type === 'boolean') return v.value;
  if (v.type === 'number') return v.value !== 0;
  return null;
}

const andImpl: FunctionImpl = (args) => {
  for (const v of flatten(args)) {
    if (v.type === 'empty') continue;
    const b = toLogical(v);
    if (b === null) return err('#VALUE!', 'AND 需要逻辑值');
    if (!b) return { type: 'boolean', value: false };
  }
  return { type: 'boolean', value: true };
};

const orImpl: FunctionImpl = (args) => {
  for (const v of flatten(args)) {
    if (v.type === 'empty') continue;
    const b = toLogical(v);
    if (b === null) return err('#VALUE!', 'OR 需要逻辑值');
    if (b) return { type: 'boolean', value: true };
  }
  return { type: 'boolean', value: false };
};

const notImpl: FunctionImpl = (args) => {
  const v = flatten(args)[0] ?? EMPTY;
  const b = toLogical(v);
  if (b === null) return err('#VALUE!', 'NOT 需要逻辑值');
  return { type: 'boolean', value: !b };
};

const countImpl: FunctionImpl = (args) => ({
  type: 'number',
  value: flatten(args).filter((v) => v.type === 'number').length,
});

const countaImpl: FunctionImpl = (args) => ({
  type: 'number',
  value: flatten(args).filter((v) => v.type !== 'empty').length,
});

export class FunctionRegistry {
  private readonly map = new Map<string, RegisteredFunction>();

  register(sig: FunctionSignature, impl: FunctionImpl): void {
    this.map.set(sig.name, { signature: sig, impl });
  }

  has(name: string): boolean {
    return this.map.has(name.toUpperCase());
  }

  get(name: string): RegisteredFunction | undefined {
    return this.map.get(name.toUpperCase());
  }

  names(): string[] {
    return [...this.map.keys()];
  }

  /** 校验参数个数，失败返回错误值 */
  validate(name: string, argCount: number): CellValue | null {
    const fn = this.get(name);
    if (!fn) return err('#NAME?', `未知函数: ${name}`);
    return validateArity(fn.signature, argCount);
  }
}

/** 创建包含全部内置函数的注册表 */
export function createBuiltinRegistry(): FunctionRegistry {
  const reg = new FunctionRegistry();
  const defs: Array<[FunctionSignature, FunctionImpl]> = [
    [{ name: 'SUM', arity: -1, description: '求和' }, sumImpl],
    [{ name: 'AVERAGE', arity: -1, description: '平均值' }, averageImpl],
    [{ name: 'MIN', arity: -1, description: '最小值' }, minImpl],
    [{ name: 'MAX', arity: -1, description: '最大值' }, maxImpl],
    [{ name: 'ROUND', arity: 2, description: '四舍五入' }, roundImpl],
    [{ name: 'ABS', arity: 1, description: '绝对值' }, absImpl],
    [
      { name: 'IF', arity: [1, 3] as const, lazy: true, description: '条件判断' },
      ifImpl,
    ],
    [{ name: 'AND', arity: -1, description: '逻辑与' }, andImpl],
    [{ name: 'OR', arity: -1, description: '逻辑或' }, orImpl],
    [{ name: 'NOT', arity: 1, description: '逻辑非' }, notImpl],
    [{ name: 'COUNT', arity: -1, description: '计数（数字）' }, countImpl],
    [{ name: 'COUNTA', arity: -1, description: '计数（非空）' }, countaImpl],
  ];
  for (const [sig, impl] of defs) reg.register(sig, impl);
  return reg;
}
