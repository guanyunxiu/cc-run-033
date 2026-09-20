/**
 * AST 树展示（特性 12）：将 AST 渲染为可折叠的 <ul> 树。
 */
import type { A1Node } from '../core/types.js';

const NODE_LABELS: Record<A1Node['kind'], string> = {
  number: 'Number',
  text: 'Text',
  boolean: 'Boolean',
  ref: 'Ref',
  range: 'Range',
  unary: 'Unary',
  percent: 'Percent',
  binary: 'Binary',
  function: 'Function',
  nameError: 'NameError',
};

function nodeSummary(node: A1Node): string {
  switch (node.kind) {
    case 'number':
      return String(node.value);
    case 'text':
      return `"${node.value}"`;
    case 'boolean':
      return String(node.value);
    case 'ref': {
      const col = String.fromCharCode(65 + node.col);
      return `${node.absoluteCol ? '$' : ''}${col}${node.absoluteRow ? '$' : ''}${node.row + 1}`;
    }
    case 'range':
      return 'Range';
    case 'unary':
      return node.operator;
    case 'percent':
      return '%';
    case 'binary':
      return node.operator;
    case 'function':
      return node.name;
    case 'nameError':
      return node.name;
  }
}

export function renderAstTree(ast: A1Node | undefined, container: HTMLElement): void {
  container.innerHTML = '';
  if (!ast) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.textContent = '当前单元格不是公式';
    container.appendChild(empty);
    return;
  }
  container.appendChild(buildNode(ast));
}

function buildNode(node: A1Node): HTMLElement {
  const li = document.createElement('li');
  const row = document.createElement('span');
  row.className = `ast-node ast-${node.kind}`;

  const hasChildren =
    node.kind === 'unary' ||
    node.kind === 'percent' ||
    node.kind === 'binary' ||
    node.kind === 'function' ||
    node.kind === 'range';

  row.innerHTML = `<span class="ast-kind">${NODE_LABELS[node.kind]}</span><span class="ast-value"></span><span class="ast-pos">[${node.pos.start},${node.pos.end})</span>`;
  (row.querySelector('.ast-value') as HTMLElement).textContent = ` ${nodeSummary(node)}`;
  li.appendChild(row);

  if (hasChildren) {
    const ul = document.createElement('ul');
    const children: A1Node[] = [];
    if (node.kind === 'unary' || node.kind === 'percent') children.push(node.operand);
    else if (node.kind === 'binary') children.push(node.left, node.right);
    else if (node.kind === 'function') children.push(...node.args);
    else if (node.kind === 'range') children.push(node.start, node.end);
    for (const child of children) ul.appendChild(buildNode(child));
    li.appendChild(ul);
    row.addEventListener('click', () => {
      ul.classList.toggle('collapsed');
    });
  }
  return li;
}
