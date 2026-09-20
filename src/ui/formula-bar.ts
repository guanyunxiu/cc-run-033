/**
 * 公式栏（特性 4）：名称框 + 输入框。
 * 显示活动单元格原始输入；提交后写入 Worker。
 * 公式解析错误时在下方展示定位信息（特性 11）。
 */
import { formatAddr, lettersToCol } from '../core/address.js';
import { state } from './state.js';

export interface FormulaBarCallbacks {
  onCommit(row: number, col: number, raw: string): void;
  onActiveMove(row: number, col: number): void;
}

export class FormulaBar {
  readonly root: HTMLDivElement;
  private readonly nameBox: HTMLInputElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLDivElement;

  constructor(private readonly cb: FormulaBarCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'formula-bar';

    this.nameBox = document.createElement('input');
    this.nameBox.className = 'name-box';
    this.nameBox.value = 'A1';
    this.nameBox.addEventListener('change', () => {
      const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(this.nameBox.value.trim());
      if (m) {
        const col = lettersToCol(m[1]!);
        const row = Number(m[2]) - 1;
        this.cb.onActiveMove(row, col);
      }
    });

    const fx = document.createElement('span');
    fx.className = 'fx-label';
    fx.textContent = 'fx';

    this.input = document.createElement('input');
    this.input.className = 'formula-input';
    this.input.placeholder = '输入值或公式，例如 =SUM(A1:A3)+1';
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commit();
      }
    });

    this.error = document.createElement('div');
    this.error.className = 'formula-error';

    this.root.append(this.nameBox, fx, this.input, this.error);
  }

  private commit(): void {
    const { active } = state.selection;
    this.cb.onCommit(active.row, active.col, this.input.value);
  }

  /** 活动单元格变化 / 快照刷新时同步 */
  sync(): void {
    const { active } = state.selection;
    const addr = formatAddr(active);
    this.nameBox.value = addr;
    const computed = state.snapshot?.cells[addr];
    // 正在编辑时不抢输入
    if (document.activeElement !== this.input) {
      this.input.value = computed?.raw ?? '';
    }
    if (computed?.parseError) {
      const pe = computed.parseError;
      const raw = computed.raw.startsWith('=') ? computed.raw.slice(1) : computed.raw;
      const caret = ' '.repeat(pe.offset) + '^'.repeat(Math.max(1, pe.length));
      this.error.textContent = `${pe.kind} ${pe.message}（位置 ${pe.offset}）`;
      this.error.title = `${raw}\n${caret}`;
      this.error.classList.add('visible');
      this.input.classList.add('has-error');
    } else {
      this.error.classList.remove('visible');
      this.input.classList.remove('has-error');
      this.error.textContent = '';
    }
  }
}
