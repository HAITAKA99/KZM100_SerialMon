/**
 * app.js
 * かざみんリアルタイムモニター メインアプリケーションコントローラー
 */

import { SerialManager } from './serial/serial-manager.js';
import {
  StorageManager,
  LONG_TERM_INTERVAL_MS,
  SHORT_TERM_RETENTION_DAYS,
  LONG_TERM_RETENTION_DAYS
} from './storage/db.js';
import { ChartAggregator, TIME_SCALES, calculateAveragePoint } from './data/aggregator.js';
import { exportToCsv, exportLongTermToCsv } from './export/csv-exporter.js';

import { DigitalClock } from './components/digital-clock.js';
import { WindDirectionGauge } from './components/wind-direction-gauge.js';
import { WindSpeedGauge } from './components/wind-speed-gauge.js';
import { TemperatureGauge } from './components/temperature-gauge.js';
import { TimeSeriesChart } from './components/time-series-chart.js';
import { ConsoleViewer } from './components/console-viewer.js';

class App {
  constructor() {
    this.serialManager = new SerialManager();
    this.storageManager = new StorageManager();
    this.aggregator = new ChartAggregator('10m');
    this.recentPackets = [];

    // 3年間ログ（16.8分＝1,008秒間隔集約）用の現在バケット管理
    this.longTermBucketId = null;
    this.longTermBucketPackets = [];

    // UI コンポーネント参照
    this.clock = null;
    this.dirGauge = null;
    this.speedGauge = null;
    this.tempGauge = null;
    this.chart = null;
    this.consoleViewer = null;

    // DOM 要素
    this.btnConnect = document.getElementById('btn-connect');
    this.btnDemo = document.getElementById('btn-demo');
    this.statusDot = document.getElementById('status-dot');
    this.statusText = document.getElementById('status-text');
    this.btnExportCsv = document.getElementById('btn-export-csv');
    this.btnExportCsv3y = document.getElementById('btn-export-csv-3y');
    this.btnClearDb = document.getElementById('btn-clear-db');

    // ログ消去ダイアログ要素
    this.clearLogModal = document.getElementById('clear-log-modal');
    this.btnClear7d = document.getElementById('btn-clear-7d');
    this.btnClear3y = document.getElementById('btn-clear-3y');
    this.btnClearCancel = document.getElementById('btn-clear-cancel');
  }

  async init() {
    console.log('かざみんリアルタイムモニター ver.0.2.0 起動中...');

    // 1. UI コンポーネントの初期化（同期実行で即座に画面構築）
    this.clock = new DigitalClock(document.getElementById('clock-container'));
    this.dirGauge = new WindDirectionGauge(document.getElementById('gauge-dir-container'));
    this.speedGauge = new WindSpeedGauge(document.getElementById('gauge-speed-container'), 10);
    this.tempGauge = new TemperatureGauge(document.getElementById('gauge-temp-container'));
    this.consoleViewer = new ConsoleViewer(document.getElementById('console-container'), 200);

    // 2. 時系列チャートの初期化
    this.chart = new TimeSeriesChart(document.getElementById('chart-container'), {
      // 風速スケール変更時に風速メーターのスケールを連動更新
      onSpeedScaleChange: (newMax) => {
        if (this.speedGauge) {
          this.speedGauge.setScale(newMax);
        }
      },
      // 気温スケール変更時に温度計のスケールを連動更新
      onTempScaleChange: (newScale) => {
        if (this.tempGauge) {
          this.tempGauge.setScale(newScale);
        }
      },
      // 時間スケール変更時の処理
      onTimeScaleChange: async (newScale) => {
        await this._handleTimeScaleChange(newScale);
      }
    });

    // 3. イベントバインディング & シリアルコールバック設定
    // IndexedDB の非同期処理を待たずに起動直後から「接続」「デモ」を操作可能にする
    this._bindEvents();
    this._setupSerialCallbacks();

    // URLパラメータ ?demo=true があれば自動でデモモード起動
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === 'true' || urlParams.get('demo') === '1') {
      this.serialManager.startDemo();
    }
    const testPacket = urlParams.get('packet');
    if (testPacket) {
      this.serialManager._handleRawLine(testPacket);
    }

    console.log('かざみんリアルタイムモニター 準備完了');

    // 4. IndexedDB 初期化・履歴復元・古いデータのパージ
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist().catch(() => {});
      }
      await this.storageManager.init();
      // 現在進行中の16.8分バケットがDBに存在する場合は生パケット群を引き継ぐ
      await this._restoreCurrentLongTermBucket();
      // 初期スケールの履歴データをIndexedDBから復元して描画
      await this._handleTimeScaleChange(this.chart.timeScale || '10m');
      // 7日以前の短期データおよび3年以前の長期データを一括パージ
      await this.storageManager.purgeOldData(SHORT_TERM_RETENTION_DAYS);
      await this.storageManager.purgeOldLongTermData(LONG_TERM_RETENTION_DAYS);
      // 1時間おきに古いデータをパージ
      setInterval(() => {
        this.storageManager.purgeOldData(SHORT_TERM_RETENTION_DAYS);
        this.storageManager.purgeOldLongTermData(LONG_TERM_RETENTION_DAYS);
      }, 3600 * 1000);
    } catch (e) {
      console.warn('Storage init warning:', e);
    }
  }

  _bindEvents() {
    // 接続 / 切断ボタン
    this.btnConnect.addEventListener('click', async () => {
      if (this.serialManager.isConnected) {
        await this.serialManager.disconnect();
      } else {
        try {
          await this.serialManager.connect();
        } catch (err) {
          if (err.name !== 'NotFoundError') {
            alert(`接続エラー: ${err.message}`);
          }
        }
      }
    });

    // デモモード切替ボタン
    this.btnDemo.addEventListener('click', () => {
      if (this.serialManager.isDemoMode) {
        this.serialManager.stopDemo();
      } else {
        this.serialManager.startDemo();
      }
    });

    // CSV(7日間)エクスポートボタン
    if (this.btnExportCsv) {
      this.btnExportCsv.addEventListener('click', async () => {
        try {
          const records = await this.storageManager.getAll();
          if (!records || records.length === 0) {
            alert('保存されているデータがまだありません。');
            return;
          }
          exportToCsv(records, 'kazamin_log_7d');
        } catch (err) {
          alert(`CSV出力エラー: ${err.message}`);
        }
      });
    }

    // CSV(3年間)エクスポートボタン
    if (this.btnExportCsv3y) {
      this.btnExportCsv3y.addEventListener('click', async () => {
        try {
          const records = await this.storageManager.getAllLongTerm();
          if (!records || records.length === 0) {
            alert('保存されているデータがまだありません。');
            return;
          }
          exportLongTermToCsv(records, 'kazamin_log_3y');
        } catch (err) {
          alert(`CSV出力エラー: ${err.message}`);
        }
      });
    }

    // ログ消去ボタン（選択ダイアログを開く）
    if (this.btnClearDb) {
      this.btnClearDb.addEventListener('click', () => {
        this._openClearLogModal();
      });
    }

    // ダイアログ: 7日間ログ消去
    if (this.btnClear7d) {
      this.btnClear7d.addEventListener('click', async () => {
        this._closeClearLogModal();
        try {
          this.recentPackets = [];
          await this.storageManager.clear();
          await this._handleTimeScaleChange(this.chart.timeScale || '10m');
          alert('7日間ログを消去しました。');
        } catch (err) {
          alert(`ログ消去エラー: ${err.message}`);
        }
      });
    }

    // ダイアログ: 3年間ログ消去
    if (this.btnClear3y) {
      this.btnClear3y.addEventListener('click', async () => {
        this._closeClearLogModal();
        try {
          this.longTermBucketId = null;
          this.longTermBucketPackets = [];
          await this.storageManager.clearLongTerm();
          alert('3年間ログを消去しました。');
        } catch (err) {
          alert(`ログ消去エラー: ${err.message}`);
        }
      });
    }

    // ダイアログ: キャンセル & オーバーレイ外クリック & Escapeキー
    if (this.btnClearCancel) {
      this.btnClearCancel.addEventListener('click', () => {
        this._closeClearLogModal();
      });
    }

    if (this.clearLogModal) {
      this.clearLogModal.addEventListener('click', (e) => {
        if (e.target === this.clearLogModal) {
          this._closeClearLogModal();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.clearLogModal && !this.clearLogModal.hidden) {
        this._closeClearLogModal();
      }
    });
  }

  _openClearLogModal() {
    if (!this.clearLogModal) return;
    this.clearLogModal.hidden = false;
    this.clearLogModal.setAttribute('aria-hidden', 'false');
  }

  _closeClearLogModal() {
    if (!this.clearLogModal) return;
    this.clearLogModal.hidden = true;
    this.clearLogModal.setAttribute('aria-hidden', 'true');
  }

  _setupSerialCallbacks() {
    // データ受信時コールバック
    this.serialManager.onPacketReceived = (packet) => {
      this._handlePacket(packet);
    };

    // 状態変化時コールバック
    this.serialManager.onStatusChange = (status, state) => {
      this._handleStatusChange(status, state);
    };

    // エラー時
    this.serialManager.onError = (err) => {
      console.error('SerialManager error:', err);
    };
  }

  /**
   * 受信パケットの各コンポーネントへのディスパッチ
   */
  _handlePacket(packet) {
    if (!packet) return;

    // 1. 各リアルタイムメーターの更新
    this.dirGauge.update(packet);
    this.speedGauge.update(packet);
    this.tempGauge.update(packet);

    // 2. 受信コンソールに追加
    this.consoleViewer.addPacket(packet);

    // 3. グラフ集約エンジンに追加 & チャート再描画
    this.aggregator.addPacket(packet);
    this.chart.updateData(this.aggregator.getPlotData());

    // 4. IndexedDB に永続化（7日間生データ & 3年間16.8分集約データ） & 直近メモリバッファに保持（上限600件）
    if (packet.isValid) {
      this.recentPackets.push(packet);
      while (this.recentPackets.length > 600) {
        this.recentPackets.shift();
      }
      this.storageManager.savePacket(packet);
      this._updateLongTermLog(packet);
    }
  }

  /**
   * 3年間ログ（16.8分＝1,008秒間隔集約）の更新と保存
   * @param {object} packet
   */
  _updateLongTermLog(packet) {
    const pTime = packet.timestamp instanceof Date
      ? packet.timestamp.getTime()
      : new Date(packet.timestamp).getTime();
    const bucketId = Math.floor(pTime / LONG_TERM_INTERVAL_MS);

    if (this.longTermBucketId === null) {
      this.longTermBucketId = bucketId;
      this.longTermBucketPackets = [packet];
    } else if (bucketId === this.longTermBucketId) {
      this.longTermBucketPackets.push(packet);
    } else if (bucketId > this.longTermBucketId) {
      const prevPoint = calculateAveragePoint(this.longTermBucketPackets);
      if (prevPoint) {
        this.storageManager.saveLongTermPoint(this.longTermBucketId, prevPoint);
      }
      this.longTermBucketId = bucketId;
      this.longTermBucketPackets = [packet];
    }

    const currentPoint = calculateAveragePoint(this.longTermBucketPackets);
    if (currentPoint) {
      this.storageManager.saveLongTermPoint(this.longTermBucketId, currentPoint);
    }
  }

  /**
   * ページ再読み込み時に現在進行中の16.8分バケットがあれば7日間ログからパケット群を復元
   */
  async _restoreCurrentLongTermBucket() {
    try {
      const currentBucketId = Math.floor(Date.now() / LONG_TERM_INTERVAL_MS);
      const existingBucket = await this.storageManager.getLongTermBucket(currentBucketId);
      if (!existingBucket) return;

      const bucketStartMs = currentBucketId * LONG_TERM_INTERVAL_MS;
      const history = await this.storageManager.getSince(bucketStartMs);
      const bucketPackets = history
        .filter((h) => Math.floor(h.timestamp / LONG_TERM_INTERVAL_MS) === currentBucketId)
        .map((h) => ({
          isValid: true,
          timestamp: new Date(h.timestamp),
          speed: h.speed,
          direction: h.direction,
          temperature: h.temperature,
          isError: h.isError,
          raw: h.raw
        }));

      if (bucketPackets.length > 0 && this.longTermBucketId === null) {
        this.longTermBucketId = currentBucketId;
        this.longTermBucketPackets = bucketPackets;
      }
    } catch (e) {
      console.warn('Failed to restore current long-term bucket:', e);
    }
  }

  /**
   * シリアル状態の変化ハンドラ
   */
  _handleStatusChange(status, state) {
    if (state.isDemoMode) {
      this.statusDot.className = 'connection-status-dot demo';
      this.statusText.textContent = 'デモ中';
      this.btnDemo.classList.add('active');
      this.btnDemo.textContent = 'デモ停止';
      this.btnConnect.disabled = true;
    } else if (state.isConnected) {
      this.statusDot.className = 'connection-status-dot connected';
      this.statusText.textContent = '接続中';
      this.btnConnect.textContent = '切断';
      this.btnConnect.classList.remove('btn-primary');
      this.btnConnect.classList.add('btn-danger');
      this.btnDemo.disabled = true;
    } else {
      this.statusDot.className = 'connection-status-dot';
      this.statusText.textContent = '未接続';
      this.btnConnect.textContent = '接続';
      this.btnConnect.classList.remove('btn-danger');
      this.btnConnect.classList.add('btn-primary');
      this.btnConnect.disabled = false;
      this.btnDemo.classList.remove('active');
      this.btnDemo.textContent = 'デモ';
      this.btnDemo.disabled = false;
    }
  }

  /**
   * 時間スケール変更時の履歴パケット再集約
   */
  async _handleTimeScaleChange(newScale) {
    const scaleConfig = TIME_SCALES[newScale];
    if (!scaleConfig) return;

    const sinceTime = Date.now() - scaleConfig.durationSec * 1000;

    try {
      // 必要な期間のデータを IndexedDB から取得
      const history = await this.storageManager.getSince(sinceTime);

      // パケット形式に適合させて aggregator を再構築
      const packets = history.map((h) => ({
        isValid: true,
        timestamp: new Date(h.timestamp),
        speed: h.speed,
        direction: h.direction,
        temperature: h.temperature,
        isError: h.isError,
        raw: h.raw
      }));

      // 非同期取得中にメモリ上で受信した最新パケットがあればマージする
      const lastDbMs = packets.length > 0
        ? packets[packets.length - 1].timestamp.getTime()
        : 0;
      for (const p of this.recentPackets) {
        const pMs = p.timestamp instanceof Date ? p.timestamp.getTime() : new Date(p.timestamp).getTime();
        if (pMs >= sinceTime && pMs > lastDbMs) {
          packets.push(p);
        }
      }

      this.aggregator.setScale(newScale, packets);
      this.chart.updateData(this.aggregator.getPlotData());
    } catch (e) {
      console.warn('Failed to rebuild from history:', e);
      const fallbackPackets = this.recentPackets.filter((p) => {
        const pMs = p.timestamp instanceof Date ? p.timestamp.getTime() : new Date(p.timestamp).getTime();
        return pMs >= sinceTime;
      });
      this.aggregator.setScale(newScale, fallbackPackets);
      this.chart.updateData(this.aggregator.getPlotData());
    }
  }
}

// アプリケーション起動
function startApp() {
  const app = new App();
  app.init();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
