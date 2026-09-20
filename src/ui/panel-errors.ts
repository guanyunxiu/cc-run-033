/**
 * 错误列表面板（特性 32）：聚合所有错误单元格，点击可定位。
 */
import { state } from './state.js';

export function renderErrorList(container: HTMLElement, onSelect: (addr: string) => void): void {
  container.innerHTML = '';
  const snapshot = state.snapshot;
  if (!snapshot) return;

  if (snapshot.errors.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty ok';
    empty.textContent = '✓ 没有错误';
    container.appendChild(empty);
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'panel-meta';
  const groups = new Map<string, number>();
  for (const e of snapshot.errors) groups.set(e.kind, (groups.get(e.kind) ?? 0) + 1);
  summary.textContent = [...groups].map(([k, n]) => `${k} × ${n}`).join('　');
  container.appendChild(summary);

  const ul = document.createElement('ul');
  ul.className = 'error-list';
  for (const e of snapshot.errors) {
    const li = document.createElement('li');
    li.className = 'error-item';
    const addr = document.createElement('span');
    addr.className = 'error-addr';
    addr.textContent = e.address;
    const kind = document.createElement('span');
    kind.className = 'error-kind';
    kind.textContent = e.kind;
    const msg = document.createElement('span');
    msg.className = 'error-msg';
    msg.textContent = e.message;
    li.append(addr, kind, msg);
    li.addEventListener('click', () => onSelect(e.address));
    ul.appendChild(li);
  }
  container.appendChild(ul);
}
