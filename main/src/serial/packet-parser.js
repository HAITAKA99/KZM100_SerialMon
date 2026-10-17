/**
 * packet-parser.js
 * かざみん(KZM100A/KZM100LR)のシリアル通信パケット解析モジュール
 *
 * 受信仕様:
 * - ボーレート: 9600bps
 * - フォーマット: 00.0[m/s],000,+00.0[CR/LF]
 *   - 風速: 00.0 ～ 99.9 [m/s] (99.9は計測エラー)
 *   - 風向: 000 ～ 359 [度]
 *   - 気温: -20.0 ～ +65.0 [℃]
 */

// パケットの正規表現: 固定桁数を基本としつつ、前後の空白や桁数のわずかな差異にも柔軟に対応
// 例: "12.3[m/s],045,+23.5\r\n" や "00.0[m/s],000,-05.2"
export const PACKET_REGEX = /^\s*(\d{1,2}\.\d)\[m\/s\],\s*(\d{1,3}),\s*([+-]?\d{1,2}\.\d)\s*$/;

/**
 * 1行のテキストをパースして構造化データを返す
 * @param {string} line - 受信した1行文字列
 * @param {Date} [timestamp=new Date()] - 受信日時
 * @returns {object|null} パース結果。不正パケットの場合はnull
 */
export function parsePacket(line, timestamp = new Date()) {
  if (typeof line !== 'string') return null;

  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(PACKET_REGEX);
  if (!match) {
    return {
      isValid: false,
      raw: trimmed,
      timestamp,
      errorReason: 'FORMAT_MISMATCH'
    };
  }

  const speedStr = match[1];
  const dirStr = match[2];
  const tempStr = match[3];

  const speed = parseFloat(speedStr);
  const direction = parseInt(dirStr, 10);
  const temperature = parseFloat(tempStr);

  // 風速 99.9 [m/s] は計測エラー
  const isError = Math.abs(speed - 99.9) < 0.05;

  // 範囲チェック
  // 風速: 0.0 〜 99.9
  // 風向: 0 〜 359
  // 気温: -20.0 〜 +65.0
  const isDirValid = direction >= 0 && direction <= 359;
  const isTempValid = temperature >= -20.0 && temperature <= 65.0;
  const isSpeedValid = speed >= 0.0 && speed <= 99.9;

  if (!isDirValid || !isTempValid || !isSpeedValid) {
    return {
      isValid: false,
      raw: trimmed,
      timestamp,
      errorReason: 'OUT_OF_RANGE'
    };
  }

  return {
    isValid: true,
    raw: trimmed,
    timestamp,
    speed,
    speedStr,
    direction,
    dirStr,
    temperature,
    tempStr,
    isError
  };
}
