/**
 * 地址格式：A1 / $A$1（特性 6），区域引用 A1:B10（特性 7、13、14）。
 */
import { FormulaError } from './types.js';

export interface CellAddr {
  row: number; // 0-based
  col: number; // 0-based
}

export interface RefParts {
  col: number;
  row: number;
  absoluteCol: boolean;
  absoluteRow: boolean;
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)$/;

/** 将 0-based 列号转为字母：0 -> A */
export function colToLetters(col: number): string {
  let n = col;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** 字母列转 0-based 列号：A -> 0 */
export function lettersToCol(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return n - 1;
}

/** 格式化为 A1 地址（忽略绝对标记，用于展示） */
export function formatAddr(addr: CellAddr): string {
  return `${colToLetters(addr.col)}${addr.row + 1}`;
}

/** 带绝对标记格式化 */
export function formatRef(p: RefParts): string {
  return `${p.absoluteCol ? '$' : ''}${colToLetters(p.col)}${p.absoluteRow ? '$' : ''}${p.row + 1}`;
}

/**
 * 解析单个引用，例如 A1、$A$1、A$1、$A1。
 * 非法时抛出 #REF! / #NAME? 错误（带定位由调用方补充 offset）。
 */
export function parseRef(text: string, offset = 0): RefParts {
  const m = REF_RE.exec(text);
  if (!m) {
    throw new FormulaError('#REF!', `无效的单元格引用: ${text}`, offset, text.length);
  }
  const [, dollarCol, letters, dollarRow, digits] = m;
  const col = lettersToCol(letters);
  const row = Number(digits) - 1;
  // Excel 上限 XFD1048576
  if (col > 16383 || row > 1048575) {
    throw new FormulaError('#REF!', `引用超出网格范围: ${text}`, offset, text.length);
  }
  return {
    col,
    row,
    absoluteCol: dollarCol === '$',
    absoluteRow: dollarRow === '$',
  };
}

/** 判断字符串是否“看起来像”引用（不做边界校验） */
export function looksLikeRef(text: string): boolean {
  return REF_RE.test(text);
}

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** 归一化区域（特性 7）：处理反向区域如 B10:A1 */
export function normalizeRect(a: CellAddr, b: CellAddr): Rect {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

/** 将区域展开为单元格地址列表（特性 14） */
export function expandRect(rect: Rect): CellAddr[] {
  const out: CellAddr[] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      out.push({ row: r, col: c });
    }
  }
  return out;
}

/** 区域 ID，例如 A1:B2 */
export function formatRect(rect: Rect): string {
  return `${formatAddr({ row: rect.top, col: rect.left })}:${formatAddr({
    row: rect.bottom,
    col: rect.right,
  })}`;
}
