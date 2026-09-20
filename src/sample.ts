/** 启动时加载的示例工作簿，覆盖全部函数、错误传播与循环引用演示。 */
export interface SampleCell {
  col: number;
  row: number;
  raw: string;
}

export const SAMPLE_CELLS: SampleCell[] = [
  // 第 1 行：表头
  { col: 0, row: 0, raw: '项目' },
  { col: 1, row: 0, raw: '一月' },
  { col: 2, row: 0, raw: '二月' },
  { col: 3, row: 0, raw: '三月' },
  { col: 4, row: 0, raw: '合计' },
  { col: 5, row: 0, raw: '评价' },

  // 数据行
  { col: 0, row: 1, raw: '销量' },
  { col: 1, row: 1, raw: '120' },
  { col: 2, row: 1, raw: '150' },
  { col: 3, row: 1, raw: '135' },
  { col: 4, row: 1, raw: '=SUM(B2:D2)' },
  { col: 5, row: 1, raw: '=IF(E2>=400,"达标","加油")' },

  { col: 0, row: 2, raw: '退货' },
  { col: 1, row: 2, raw: '20' },
  { col: 2, row: 2, raw: '5' },
  { col: 3, row: 2, raw: '0' },
  { col: 4, row: 2, raw: '=SUM(B3:D3)' },

  { col: 0, row: 3, raw: '净销量' },
  { col: 1, row: 3, raw: '=B2-B3' },
  { col: 2, row: 3, raw: '=C2-C3' },
  { col: 3, row: 3, raw: '=D2-D3' },
  { col: 4, row: 3, raw: '=SUM(B4:D4)' },

  // 统计区
  { col: 0, row: 5, raw: '总净销量' },
  { col: 1, row: 5, raw: '=SUM(B4:D4)' },
  { col: 0, row: 6, raw: '月均' },
  { col: 1, row: 6, raw: '=AVERAGE(B4:D4)' },
  { col: 0, row: 7, raw: '最高月' },
  { col: 1, row: 7, raw: '=MAX(B4:D4)' },
  { col: 0, row: 8, raw: '最低月' },
  { col: 1, row: 8, raw: '=MIN(B4:D4)' },
  { col: 0, row: 9, raw: '四舍五入' },
  { col: 1, row: 9, raw: '=ROUND(B7/3,2)' },
  { col: 0, row: 10, raw: '绝对值' },
  { col: 1, row: 10, raw: '=ABS(B3-C2)' },
  { col: 0, row: 11, raw: '数字单元格' },
  { col: 1, row: 11, raw: '=COUNT(B2:D4)' },
  { col: 0, row: 12, raw: '非空单元格' },
  { col: 1, row: 12, raw: '=COUNTA(A1:F5)' },

  // 逻辑运算
  { col: 0, row: 14, raw: 'AND 判断' },
  { col: 1, row: 14, raw: '=AND(B2>100,C2>100)' },
  { col: 0, row: 15, raw: 'OR 判断' },
  { col: 1, row: 15, raw: '=OR(D3>200,D3<0)' },
  { col: 0, row: 16, raw: 'NOT 判断' },
  { col: 1, row: 16, raw: '=NOT(B15)' },

  // 错误类型演示
  { col: 0, row: 18, raw: '#DIV/0!' },
  { col: 1, row: 18, raw: '=1/0' },
  { col: 2, row: 18, raw: '=B19+1' },
  { col: 0, row: 19, raw: '#VALUE!' },
  { col: 1, row: 19, raw: '="abc"+1' },
  { col: 0, row: 20, raw: '#NAME?' },
  { col: 1, row: 20, raw: '=FOO(1)' },
  { col: 0, row: 21, raw: '文本传播' },
  { col: 1, row: 21, raw: '=SUM(B19:B20)' },
  { col: 0, row: 22, raw: '错误字面量' },
  { col: 1, row: 22, raw: '#N/A' },
  { col: 1, row: 23, raw: '=B23&" 后缀"' },

  // 绝对/相对引用演示
  { col: 0, row: 24, raw: '税率' },
  { col: 1, row: 24, raw: '0.13' },
  { col: 0, row: 25, raw: '含税合计' },
  { col: 1, row: 25, raw: '=ROUND(E4*(1+$B$25),2)' },

  // 循环引用演示（三种）：
  // 自引用：B27 = B27+1
  { col: 0, row: 26, raw: '自引用循环' },
  { col: 1, row: 26, raw: '=B27+1' },
  // 直接循环：B29 <-> C29
  { col: 0, row: 28, raw: '直接循环 A' },
  { col: 1, row: 28, raw: '=C29+1' },
  { col: 2, row: 28, raw: '=B29+1' },
  // 间接循环：B31 -> C31 -> D31 -> B31
  { col: 0, row: 30, raw: '间接循环' },
  { col: 1, row: 30, raw: '=C31+1' },
  { col: 2, row: 30, raw: '=D31+1' },
  { col: 3, row: 30, raw: '=B31+1' },
  // 循环下游：引用自引用循环单元格 B27，错误继续传播
  { col: 0, row: 32, raw: '循环下游' },
  { col: 1, row: 32, raw: '=B27*2' },
];
