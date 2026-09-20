/**
 * UI 冒烟测试（jsdom）：网格、公式栏、图视图可渲染且交互不抛异常。
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { GridView, ROWS, COLS } from '../src/ui/grid.js';
import { FormulaBar } from '../src/ui/formula-bar.js';
import { GraphView } from '../src/ui/graph-view.js';
import { state } from '../src/ui/state.js';
import type { GraphSnapshot } from '../src/core/types.js';

const miniGraph: GraphSnapshot = {
  nodes: [
    { id: 'cell@0,0', kind: 'cell', label: 'A1', x: 0, y: 0 },
    { id: 'formula@B1', kind: 'formula', label: '=A1+1', x: 240, y: 0 },
    { id: 'cell@0,1', kind: 'cell', label: 'B1', x: 480, y: 0 },
  ],
  edges: [
    { id: 'cell@0,0->formula@B1', source: 'cell@0,0', target: 'formula@B1', kind: 'depends' },
    { id: 'formula@B1->cell@0,1', source: 'formula@B1', target: 'cell@0,1', kind: 'depends' },
  ],
};

describe('GridView 网格', () => {
  it('渲染全部行列标题与单元格', () => {
    const grid = new GridView({ onEdit: () => {}, onActiveChange: () => {} });
    document.body.appendChild(grid.root);
    expect(grid.root.querySelectorAll('.grid-cell').length).toBe(ROWS * COLS);
    expect(grid.root.querySelectorAll('.grid-col-title').length).toBe(COLS);
    expect(grid.root.querySelectorAll('.grid-row-title').length).toBe(ROWS);
  });

  it('快照渲染值并标记错误类', () => {
    const grid = new GridView({ onEdit: () => {}, onActiveChange: () => {} });
    state.snapshot = {
      cells: {
        A1: {
          row: 0, col: 0, raw: '=1/0', isFormula: true,
          value: { type: 'error', kind: '#DIV/0!' },
          deps: [], dependents: [],
        },
      },
      graph: { nodes: [], edges: [] },
      order: [],
      errors: [],
      circularNodes: [],
      timing: { parseMs: 0, graphMs: 0, topoMs: 0, evalMs: 0, totalMs: 0 },
      debug: {
        astCacheSize: 0, astCacheHits: 0, nodeCount: 0, edgeCount: 0,
        topoAlgorithm: 'kahn', cycles: [], selfLoops: [], circularNodeIds: [],
      },
    };
    grid.renderValues();
    const a1 = grid.root.querySelector('.grid-cell[data-row="0"][data-col="0"]')!;
    expect(a1.textContent).toBe('#DIV/0!');
    expect(a1.classList.contains('cell-error')).toBe(true);
  });
});

describe('FormulaBar 公式栏', () => {
  it('显示活动地址', () => {
    const bar = new FormulaBar({ onCommit: () => {}, onActiveMove: () => {} });
    bar.sync();
    expect((bar.root.querySelector('.name-box') as HTMLInputElement).value).toBe('A1');
  });
});

describe('GraphView SVG 依赖图', () => {
  it('渲染节点/边并支持节点高亮', () => {
    let highlighted = false;
    const graph = new GraphView({
      onNodeSelect: () => {},
      onHighlight: (up) => {
        if (up.size > 0) highlighted = true;
      },
    });
    document.body.appendChild(graph.root);
    graph.setSnapshot(miniGraph);
    expect(graph.root.querySelectorAll('.graph-node').length).toBe(3);
    expect(graph.root.querySelectorAll('.graph-edge').length).toBe(2);

    // 模拟悬停 B1 节点，应高亮上游 A1
    const b1 = graph.root.querySelector('.graph-node[data-id="cell@0,1"]') as SVGGElement;
    b1.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(highlighted).toBe(true);
  });
});
