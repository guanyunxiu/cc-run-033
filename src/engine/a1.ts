/**
 * A1 风格地址解析与区域展开（特性 6、7、13、14）。
 *
 * 支持四种引用形式：
 *   A1    列相对、行相对
 *   $A$1  列绝对、行绝对
 *   $A1   列绝对、行相对
 *   A$1   列相对、行绝对
 *
 * 引擎本身不做公式填充/偏移，但词法层保留绝对/相对标志，
 * 求值与依赖图按规范化地址（无 $）处理。
 */

export interface CellRef {
  /** 0 基列号 */
  col: number;
  /** 0 基行号 */
  row: number;
  colAbsolute: boolean;
  rowAbsolute: boolean;
}

export interface RangeRef {
  start: CellRef;
  end: CellRef;
}

export interface CellAddress {
  col: number;
  row: number;
}

const MAX_COL = 26 * 26 + 26 - 1; // 支持到 ZZ 列

/** 列号 -> 字母（0 -> A, 25 -> Z, 26 -> AA） */
export function columnName(col: number): string {
  if (col < 0) throw new Error(`非法列号: ${col}`);
  let n = col;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** 列字母 -> 列号 */
export function columnIndex(name: string): number {
  let n = 0;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 65 || c > 90) throw new Error(`非法列字母: ${name}`);
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

const REFERENCE_RE = /^(\$?)([A-Za-z]{1,2})(\$?)([0-9]+)$/;

/** 解析单个引用，如 "$AB$12"；失败返回 null。 */
export function parseReference(text: string): CellRef | null {
  const m = REFERENCE_RE.exec(text);
  if (!m) return null;
  const col = columnIndex(m[2].toUpperCase());
  if (col > MAX_COL) return null;
  const rowNum = parseInt(m[4], 10) - 1;
  if (rowNum < 0 || rowNum > 1_000_000) return null;
  return {
    col,
    row: rowNum,
    colAbsolute: m[1] === '$',
    rowAbsolute: m[3] === '$',
  };
}

/** 规范化为无 $ 的 A1 文本。 */
export function canonicalAddress(ref: CellAddress): string {
  return `${columnName(ref.col)}${ref.row + 1}`;
}

/** 解析区域 "A1:B10"；非区域（无冒号或非法）返回 null。 */
export function parseRange(text: string): RangeRef | null {
  const parts = text.split(':');
  if (parts.length !== 2) return null;
  const a = parseReference(parts[0]!.trim());
  const b = parseReference(parts[1]!.trim());
  if (!a || !b) return null;
  return {
    start: {
      col: Math.min(a.col, b.col),
      row: Math.min(a.row, b.row),
      colAbsolute: a.colAbsolute,
      rowAbsolute: a.rowAbsolute,
    },
    end: {
      col: Math.max(a.col, b.col),
      row: Math.max(a.row, b.row),
      colAbsolute: b.colAbsolute,
      rowAbsolute: b.rowAbsolute,
    },
  };
}

export function rangeKey(r: RangeRef): string {
  return `${canonicalAddress(r.start)}:${canonicalAddress(r.end)}`;
}

/** 区域展开为全部单元格地址（逐行展开，特性 14）。 */
export function expandRange(r: RangeRef): CellAddress[] {
  const out: CellAddress[] = [];
  for (let row = r.start.row; row <= r.end.row; row++) {
    for (let col = r.start.col; col <= r.end.col; col++) {
      out.push({ col, row });
    }
  }
  return out;
}

/** 引用是否落在区域内（按规范化坐标比较，忽略 $）。 */
export function refInRange(ref: CellAddress, r: RangeRef): boolean {
  return (
    ref.col >= r.start.col &&
    ref.col <= r.end.col &&
    ref.row >= r.start.row &&
    ref.row <= r.end.row
  );
}
