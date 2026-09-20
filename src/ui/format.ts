/**
 * 单元格值的显示格式化（主线程渲染用）。
 */
import type { CellValue } from '../core/types.js';

export function formatValue(v: CellValue): string {
  switch (v.type) {
    case 'empty':
      return '';
    case 'number':
      return Number.isInteger(v.value)
        ? String(v.value)
        : String(Math.round(v.value * 1e12) / 1e12);
    case 'text':
      return v.value;
    case 'boolean':
      return v.value ? 'TRUE' : 'FALSE';
    case 'error':
      return v.kind;
  }
}

export function valueClass(v: CellValue): string {
  switch (v.type) {
    case 'error':
      return 'cell-error';
    case 'number':
      return 'cell-number';
    case 'boolean':
      return 'cell-boolean';
    case 'text':
      return 'cell-text';
    case 'empty':
      return '';
  }
}
