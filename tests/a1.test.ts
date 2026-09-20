import { describe, expect, it } from 'vitest';
import {
  canonicalAddress,
  columnIndex,
  columnName,
  expandRange,
  parseRange,
  parseReference,
  refInRange,
} from '../src/engine/a1';

describe('A1 地址与区域', () => {
  it('列字母与列号互转', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(51)).toBe('AZ');
    expect(columnName(52)).toBe('BA');
    expect(columnIndex('A')).toBe(0);
    expect(columnIndex('AA')).toBe(26);
  });

  it('解析四种引用形式', () => {
    const a = parseReference('B3')!;
    expect(a).toMatchObject({ col: 1, row: 2, colAbsolute: false, rowAbsolute: false });
    expect(parseReference('$B$3')).toMatchObject({ colAbsolute: true, rowAbsolute: true });
    expect(parseReference('$B3')).toMatchObject({ colAbsolute: true, rowAbsolute: false });
    expect(parseReference('B$3')).toMatchObject({ colAbsolute: false, rowAbsolute: true });
  });

  it('规范化地址', () => {
    expect(canonicalAddress({ col: 0, row: 0 })).toBe('A1');
    expect(canonicalAddress({ col: 27, row: 9 })).toBe('AB10');
  });

  it('解析区域并规范化方向', () => {
    const r = parseRange('B10:A1')!;
    expect(r.start).toMatchObject({ col: 0, row: 0 });
    expect(r.end).toMatchObject({ col: 1, row: 9 });
  });

  it('区域展开按行优先', () => {
    const cells = expandRange(parseRange('A1:B2')!);
    expect(cells.map((c) => canonicalAddress(c))).toEqual([
      'A1', 'B1', 'A2', 'B2',
    ]);
  });

  it('refInRange 判断', () => {
    const r = parseRange('A1:C3')!;
    expect(refInRange({ col: 1, row: 1 }, r)).toBe(true);
    expect(refInRange({ col: 3, row: 1 }, r)).toBe(false);
  });

  it('非法引用返回 null', () => {
    expect(parseReference('1A')).toBeNull();
    expect(parseRange('A1:')).toBeNull();
  });
});
