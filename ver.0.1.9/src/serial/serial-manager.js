/**
 * serial-manager.js
 * Web Serial API の接続・データ受信管理、およびデモモード（シミュレータ）
 */

import { parsePacket } from './packet-parser.js';

export class SerialManager {
  constructor() {
    this.port = null;
    this.reader = null;
    this.readableStreamClosed = null;
    this.isConnected = false;
    this.isDemoMode = false;
    this.demoTimer = null;

    // コールバック
    this.onPacketReceived = null;
    this.onStatusChange = null;
    this.onError = null;

    // デモ用内部状態
    this.demoState = {
      speed: 4.5,
      direction: 45,
      temperature: 22.5
    };
  }

  /**
   * ブラウザがWeb Serial APIをサポートしているか
   * @returns {boolean}
   */
  static isSupported() {
    return 'serial' in navigator;
  }

  /**
   * シリアルポートを選択して接続する
   */
  async connect() {
    if (this.isDemoMode) {
      this.stopDemo();
    }

    if (!SerialManager.isSupported()) {
      throw new Error('お使いのブラウザはWeb Serial APIに対応していません。Google ChromeまたはMicrosoft Edgeをご利用ください。');
    }

    // 以前のポートが開いたまま残っていれば安全に切断・解放
    if (this.port) {
      try {
        await this.disconnect();
      } catch (e) {
        console.warn('Pre-connect disconnect warning:', e);
      }
    }

    try {
      this._updateStatus('requesting');
      // ユーザーにシリアルポートを選択させる
      this.port = await navigator.serial.requestPort();

      // ボーレート 9600bps でポートを開く（bufferSizeはドライバデフォルトに任せる）
      await this.port.open({
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none'
      });

      this.isConnected = true;
      this._updateStatus('connected');

      // 受信ループ開始（非同期バックグラウンド実行）
      this._readLoop().catch((err) => {
        console.error('Unhandled read loop error:', err);
      });
    } catch (err) {
      this.isConnected = false;
      this.port = null;
      this._updateStatus('disconnected');
      if (err.name !== 'NotFoundError') { // ユーザーキャンセル以外のエラー
        if (this.onError) this.onError(err);
      }
      throw err;
    }
  }

  /**
   * シリアル接続を切断する
   */
  async disconnect() {
    if (this.isDemoMode) {
      this.stopDemo();
      return;
    }

    if (!this.isConnected && !this.port) {
      this._updateStatus('disconnected');
      return;
    }

    this.isConnected = false;

    try {
      if (this.reader) {
        try {
          await this.reader.cancel();
        } catch (e) {
          console.warn('Reader cancel warning:', e);
        }
        try {
          this.reader.releaseLock();
        } catch (e) {
          console.warn('Reader releaseLock warning:', e);
        }
        this.reader = null;
      }

      if (this.port) {
        try {
          await this.port.close();
        } catch (e) {
          console.warn('Port close warning:', e);
        }
        this.port = null;
      }
    } finally {
      this.reader = null;
      this.port = null;
      this._updateStatus('disconnected');
    }
  }

  /**
   * シリアルポートからの読み取りループ
   * pipeTo によるストリームロックを避け、素の TextDecoder と getReader で読み取りを行う
   * @private
   */
  async _readLoop() {
    const textDecoder = new TextDecoder();
    let buffer = '';

    while (this.port && this.port.readable && this.isConnected) {
      try {
        this.reader = this.port.readable.getReader();
      } catch (err) {
        console.error('Failed to get readable stream reader:', err);
        break;
      }

      try {
        while (this.isConnected) {
          const { value, done } = await this.reader.read();
          if (done) {
            // reader.cancel() が呼ばれた
            break;
          }
          if (value) {
            buffer += textDecoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            // 最後の未完成の行を残す
            buffer = lines.pop();

            for (const line of lines) {
              if (line.trim()) {
                this._handleRawLine(line);
              }
            }
          }
        }
      } catch (readErr) {
        console.error('Serial read chunk error:', readErr);
        // USBが抜かれた等の致命的エラーでなければ少し待機
        if (!this.isConnected) break;
      } finally {
        if (this.reader) {
          try {
            this.reader.releaseLock();
          } catch (e) {}
          this.reader = null;
        }
      }
    }

    // 意図せぬ切断の場合も後処理
    if (this.isConnected) {
      await this.disconnect();
    }
  }

  /**
   * 1行の受信文字列を処理
   * @private
   */
  _handleRawLine(line) {
    const packet = parsePacket(line);
    if (packet && this.onPacketReceived) {
      this.onPacketReceived(packet);
    }
  }

  /**
   * デモモード（シミュレータ）の開始
   */
  startDemo() {
    if (this.isConnected) {
      this.disconnect();
    }
    this.isDemoMode = true;
    this._updateStatus('demo');

    // 1秒間隔でパケットを生成
    this.demoTimer = setInterval(() => {
      this._generateDemoPacket();
    }, 1000);
    // 即時1回目を発行
    this._generateDemoPacket();
  }

  /**
   * デモモードの停止
   */
  stopDemo() {
    if (this.demoTimer) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
    this.isDemoMode = false;
    this._updateStatus('disconnected');
  }

  /**
   * デモパケットの生成
   * フォーマット: 00.0[m/s],000,+00.0
   * @private
   */
  _generateDemoPacket() {
    const s = this.demoState;

    let speedStr;
    let dirStr;
    let tempStr;

    // 低確率(1/80)でランダムにエラー（99.9）をシミュレート
    if (Math.random() < 0.0125) {
      speedStr = '99.9';
    } else {
      // 風速のランダムウォーク: 0.5〜18.0 m/s 程度
      const deltaSpeed = (Math.random() - 0.48) * 0.8;
      s.speed = Math.max(0.2, Math.min(28.0, s.speed + deltaSpeed));
      speedStr = s.speed.toFixed(1).padStart(4, '0');
    }

    // 風向のランダムウォーク: 0〜359度
    const deltaDir = (Math.random() - 0.5) * 12;
    s.direction = (s.direction + deltaDir + 360) % 360;
    dirStr = Math.round(s.direction).toString().padStart(3, '0');

    // 気温のゆるやかな変動: 18.0〜28.0℃
    const deltaTemp = (Math.random() - 0.5) * 0.1;
    s.temperature = Math.max(10.0, Math.min(35.0, s.temperature + deltaTemp));
    const sign = s.temperature >= 0 ? '+' : '-';
    tempStr = sign + Math.abs(s.temperature).toFixed(1).padStart(4, '0');

    const line = `${speedStr}[m/s],${dirStr},${tempStr}`;
    this._handleRawLine(line);
  }

  /**
   * 状態変化を通知
   * @private
   */
  _updateStatus(status) {
    if (this.onStatusChange) {
      this.onStatusChange(status, {
        isConnected: this.isConnected,
        isDemoMode: this.isDemoMode
      });
    }
  }
}
