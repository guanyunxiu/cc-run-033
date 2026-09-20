/**
 * 示例数据：演示函数库、区域引用、错误传播与循环引用。
 */
export interface SampleEntry {
  row: number;
  col: number;
  raw: string;
}

export function sampleData(_rows: number, _cols: number): SampleEntry[] {
  // A 列：数字；B 列：文本/布尔；C 列：公式
  return [
    { row: 0, col: 0, raw: '10' }, // A1
    { row: 1, col: 0, raw: '20' }, // A2
    { row: 2, col: 0, raw: '30' }, // A3
    { row: 3, col: 0, raw: '5' }, // A4
    { row: 4, col: 0, raw: '7' }, // A5
    { row: 5, col: 0, raw: '9' }, // A6

    { row: 0, col: 1, raw: '苹果' }, // B1
    { row: 1, col: 1, raw: '香蕉' }, // B2
    { row: 2, col: 1, raw: '橙子' }, // B3

    { row: 0, col: 2, raw: '=SUM(A1:A6)' }, // C1 区域求和
    { row: 1, col: 2, raw: '=AVERAGE(A1:A6)' }, // C2
    { row: 2, col: 2, raw: '=MAX(A1:A6)' }, // C3
    { row: 3, col: 2, raw: '=MIN(A1:A6)' }, // C4
    { row: 4, col: 2, raw: '=ROUND(C2/3,2)' }, // C5 引用公式
    { row: 5, col: 2, raw: '=COUNT(A1:A6)' }, // C6
    { row: 6, col: 2, raw: '=COUNTA(A1:B6)' }, // C7 区域计数

    { row: 7, col: 2, raw: '=IF(C1>50,"大","小")' }, // C8 IF + 字符串拼接相关
    { row: 8, col: 2, raw: '=AND(A1>0,A2>10)' }, // C9
    { row: 9, col: 2, raw: '=OR(A4<0,A5>5)' }, // C10
    { row: 10, col: 2, raw: '=NOT(A1<0)' }, // C11
    { row: 11, col: 2, raw: '=ABS(-42)' }, // C12
    { row: 12, col: 2, raw: '=B1&"和"&B2' }, // C13 字符串拼接
    { row: 13, col: 2, raw: '=SUM(A1:A3)*2+A4^2' }, // C14 混合运算
    { row: 14, col: 2, raw: '=50/A4-A4' }, // C15 = 5

    // 错误演示
    { row: 16, col: 2, raw: '=1/0' }, // C17 #DIV/0!
    { row: 17, col: 2, raw: '=C17+1' }, // C18 错误传播
    { row: 18, col: 2, raw: '=FOO(A1)' }, // C19 #NAME?
    { row: 19, col: 2, raw: '="abc"+1' }, // C20 #VALUE!

    // 间接依赖链：D 列
    { row: 0, col: 3, raw: '=C1+100' }, // D1
    { row: 1, col: 3, raw: '=D1*2' }, // D2
    { row: 2, col: 3, raw: '=D2-C5' }, // D3

    // 标签
    { row: 0, col: 4, raw: '← 修改 A1:A6 观察 D3 重算' },
    { row: 16, col: 4, raw: '← #DIV/0! 与错误传播' },
    { row: 18, col: 4, raw: '← #NAME? 未知函数' },
  ];
}
