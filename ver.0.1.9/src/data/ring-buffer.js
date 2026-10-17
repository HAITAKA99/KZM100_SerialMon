/**
 * ring-buffer.js
 * メモリ割り当てを抑え長期連続稼働に適した固定長リングバッファ
 */

export class RingBuffer {
  /**
   * @param {number} capacity - バッファの最大容量
   */
  constructor(capacity = 600) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0; // 次に書き込むインデックス
    this.size = 0; // 現在格納されている要素数
  }

  /**
   * 要素を末尾に追加
   * @param {*} item
   */
  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * 現在の要素数を返す
   * @returns {number}
   */
  get length() {
    return this.size;
  }

  /**
   * 最も古い要素から最新の要素までの配列を生成して返す
   * （最新の要素が末尾）
   * @returns {Array}
   */
  toArray() {
    const result = new Array(this.size);
    if (this.size < this.capacity) {
      for (let i = 0; i < this.size; i++) {
        result[i] = this.buffer[i];
      }
    } else {
      // head は最も古い要素を指している
      for (let i = 0; i < this.size; i++) {
        const index = (this.head + i) % this.capacity;
        result[i] = this.buffer[index];
      }
    }
    return result;
  }

  /**
   * 最新の要素を取得
   * @returns {*}
   */
  latest() {
    if (this.size === 0) return null;
    const index = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[index];
  }

  /**
   * バッファをクリア
   */
  clear() {
    this.head = 0;
    this.size = 0;
    this.buffer.fill(undefined);
  }
}
