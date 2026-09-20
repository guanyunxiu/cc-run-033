/**
 * 重算顺序面板（特性 31）。
 */
import { state } from './state.js';

export function renderRecalcOrder(container: HTMLElement, onSelect: (addr: string) => void): void {
  container.innerHTML = '';
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const header = document.createElement('div');
  header.className = 'panel-meta';
  header.textContent = `算法：${snapshot.debug.topoAlgorithm.toUpperCase()} · ${snapshot.order.length} 个单元格参与重算`;
  container.appendChild(header);

  const ol = document.createElement('ol');
  ol.className = 'order-list';
  for (const entry of snapshot.order) {
    const li = document.createElement('li');
    li.className = `order-item status-${entry.status}`;
    const idx = document.createElement('span');
    idx.className = 'order-index';
    idx.textContent = String(entry.order + 1);
    const addr = document.createElement('span');
    addr.className = 'order-addr';
    addr.textContent = entry.address;
    const tag = document.createElement('span');
    tag.className = 'order-tag';
    tag.textContent = { ok: '正常', error: '错误', circular: '循环' }[entry.status];
    li.append(idx, addr, tag);
    li.addEventListener('click', () => onSelect(entry.address));
    ol.appendChild(li);
  }
  container.appendChild(ol);
}
