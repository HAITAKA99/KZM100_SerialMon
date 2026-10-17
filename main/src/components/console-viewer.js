/**
 * console-viewer.js
 * 受信コンソールコンポーネント
 *
 * 仕様:
 * - かざみんからの受信データをシンプルに表示
 * - タイムスタンプ表示
 * - 値に関わらず桁数・長さが揃った等幅表示
 * - 計測エラーデータ (99.9m/s) のときは行の表示色を変更
 * - 受信のたびに自動スクロール（最新が最下部）
 * - 最大200件保持
 */

import { formatTimestamp } from '../export/csv-exporter.js';

export class ConsoleViewer {
  /**
   * @param {HTMLElement} containerElement
   * @param {number} [maxItems=200]
   */
  constructor(containerElement, maxItems = 200) {
    this.container = containerElement;
    this.maxItems = maxItems;
    this.items = [];
    this.autoScroll = true;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="console-card">
        <div class="console-header">
          <div class="console-title-area">
            <span class="console-title">コンソール(Receive Console)</span>
            <span class="console-count-badge" id="console-count">0 / ${this.maxItems} 件</span>
          </div>
          <div class="console-actions">
            <label class="auto-scroll-label">
              <input type="checkbox" id="auto-scroll-toggle" checked />
              自動スクロール
            </label>
            <button type="button" class="btn-clear-console" id="btn-clear-console">クリア</button>
          </div>
        </div>

        <div class="console-table-header">
          <span class="col-time">受信日時 (TIMESTAMP)</span>
          <span class="col-speed">風速 [m/s]</span>
          <span class="col-dir">風向 [deg]</span>
          <span class="col-temp">気温 [℃]</span>
          <span class="col-status">状態</span>
          <span class="col-raw">RAW パケット</span>
        </div>

        <div class="console-body" id="console-body">
          <div class="console-placeholder" id="console-placeholder">シリアル接続待ち、またはデータ受信待機中...</div>
        </div>
      </div>
    `;

    this.bodyEl = this.container.querySelector('#console-body');
    this.countEl = this.container.querySelector('#console-count');
    this.placeholderEl = this.container.querySelector('#console-placeholder');
    this.autoScrollToggle = this.container.querySelector('#auto-scroll-toggle');
    this.clearBtn = this.container.querySelector('#btn-clear-console');

    this.autoScrollToggle.addEventListener('change', (e) => {
      this.autoScroll = e.target.checked;
    });

    this.clearBtn.addEventListener('click', () => {
      this.clear();
    });
  }

  /**
   * パケットを行として追加
   * @param {object} packet - parsePacket の戻り値
   */
  addPacket(packet) {
    if (!packet) return;

    if (this.placeholderEl && this.placeholderEl.parentNode === this.bodyEl) {
      this.bodyEl.removeChild(this.placeholderEl);
    }

    const item = {
      timestamp: packet.timestamp,
      speedStr: packet.speedStr || packet.speed.toFixed(1).padStart(4, '0'),
      dirStr: packet.dirStr || String(packet.direction).padStart(3, '0'),
      tempStr: packet.tempStr || (packet.temperature >= 0 ? `+${packet.temperature.toFixed(1)}` : packet.temperature.toFixed(1)),
      isError: packet.isError,
      isValid: packet.isValid,
      raw: packet.raw
    };

    this.items.push(item);

    // 最大保持件数を超えたら配列およびDOMの先頭（最も古い要素）を削除
    while (this.items.length > this.maxItems) {
      this.items.shift();
    }
    while (this.bodyEl.children.length >= this.maxItems) {
      this.bodyEl.removeChild(this.bodyEl.firstElementChild);
    }

    // DOMに行を追加
    const rowEl = document.createElement('div');
    rowEl.className = `console-row ${item.isError ? 'row-error' : ''} ${!item.isValid ? 'row-invalid' : ''}`;

    const timeText = formatTimestamp(item.timestamp);
    const statusText = item.isError ? 'ERR' : 'OK';

    rowEl.innerHTML = `
      <span class="col-time">${timeText}</span>
      <span class="col-speed ${item.isError ? 'val-error' : ''}">${item.speedStr}</span>
      <span class="col-dir">${item.dirStr}°</span>
      <span class="col-temp">${item.tempStr}</span>
      <span class="col-status ${item.isError ? 'badge-err' : 'badge-ok'}">${statusText}</span>
      <span class="col-raw">${item.raw}</span>
    `;

    this.bodyEl.appendChild(rowEl);

    // 件数更新
    if (this.countEl) {
      this.countEl.textContent = `${this.items.length} / ${this.maxItems} 件`;
    }

    // 自動スクロール
    if (this.autoScroll) {
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    }
  }

  clear() {
    this.items = [];
    if (this.bodyEl) {
      this.bodyEl.innerHTML = '';
      if (this.placeholderEl) {
        this.placeholderEl.style.display = 'block';
        this.bodyEl.appendChild(this.placeholderEl);
      }
    }
    if (this.countEl) {
      this.countEl.textContent = `0 / ${this.maxItems} 件`;
    }
  }
}
