/**
 * csv-exporter.js
 * 保持データ（7日間ログ / 3年間ログ）をCSV形式でファイルダウンロードするモジュール
 */

/**
 * 日付オブジェクトを YYYY/MM/DD HH:mm:ss 形式にフォーマット
 * @param {Date|number} timestamp
 * @returns {string}
 */
export function formatTimestamp(timestamp) {
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');

  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());

  return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
}

/**
 * CSV文字列からブラウザダウンロードを実行する共通ヘルパー
 * @param {string} csvContent - BOM付きCSV文字列
 * @param {string} filenamePrefix
 */
function triggerCsvDownload(csvContent, filenamePrefix) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fileDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `${filenamePrefix}_${fileDate}.csv`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 7日間ログ（1秒間隔の生データ配列）からCSV文字列を生成してブラウザダウンロードを実行する
 * @param {Array<object>} records - 測定レコードの配列
 * @param {string} [filenamePrefix='kazamin_log_7d']
 */
export function exportToCsv(records, filenamePrefix = 'kazamin_log_7d') {
  if (!records || records.length === 0) {
    alert('出力対象の受信データがありません。');
    return;
  }

  // BOM付き UTF-8 でExcelでも文字化けしないようにする
  const BOM = '\uFEFF';
  const headers = ['日時 (Timestamp)', '風速 (Wind Speed [m/s])', '風向 (Wind Direction [deg])', '気温 (Temperature [℃])', 'ステータス (Status)', '生パケット (Raw Data)'];

  const rows = [headers.join(',')];

  for (const r of records) {
    const timeStr = `"${formatTimestamp(r.timestamp)}"`;
    const speedStr = r.speed !== null && r.speed !== undefined ? r.speed.toFixed(1) : '';
    const dirStr = r.direction !== null && r.direction !== undefined ? r.direction : '';
    const tempStr = r.temperature !== null && r.temperature !== undefined ? (r.temperature >= 0 ? `+${r.temperature.toFixed(1)}` : r.temperature.toFixed(1)) : '';
    const statusStr = r.isError ? '"ERROR (99.9m/s)"' : '"OK"';
    const rawStr = r.raw ? `"${r.raw.replace(/"/g, '""')}"` : '';

    rows.push([timeStr, speedStr, dirStr, tempStr, statusStr, rawStr].join(','));
  }

  const csvContent = BOM + rows.join('\r\n');
  triggerCsvDownload(csvContent, filenamePrefix);
}

/**
 * 3年間ログ（16.8分間隔の集約プロットデータ配列）からCSV文字列を生成してブラウザダウンロードを実行する
 * @param {Array<object>} records - 長期集約レコードの配列
 * @param {string} [filenamePrefix='kazamin_log_3y']
 */
export function exportLongTermToCsv(records, filenamePrefix = 'kazamin_log_3y') {
  if (!records || records.length === 0) {
    alert('出力対象の受信データがありません。');
    return;
  }

  // BOM付き UTF-8 でExcelでも文字化けしないようにする
  const BOM = '\uFEFF';
  const headers = [
    '日時 (Timestamp)',
    '風速平均 (Wind Speed Avg [m/s])',
    '風速最小 (Wind Speed Min [m/s])',
    '風速最大 (Wind Speed Max [m/s])',
    '風速中央値 (Wind Speed Median [m/s])',
    '風向 (Wind Direction [deg])',
    '気温 (Temperature [℃])',
    'ステータス (Status)'
  ];

  const rows = [headers.join(',')];

  for (const r of records) {
    const timeStr = `"${formatTimestamp(r.timestamp)}"`;
    const speedAvgStr = r.speed !== null && r.speed !== undefined ? r.speed.toFixed(1) : '';
    const minVal = r.speedMin !== undefined ? r.speedMin : r.speed;
    const maxVal = r.speedMax !== undefined ? r.speedMax : r.speed;
    const medVal = r.speedMedian !== undefined ? r.speedMedian : r.speed;
    const speedMinStr = minVal !== null && minVal !== undefined ? minVal.toFixed(1) : '';
    const speedMaxStr = maxVal !== null && maxVal !== undefined ? maxVal.toFixed(1) : '';
    const speedMedStr = medVal !== null && medVal !== undefined ? medVal.toFixed(1) : '';
    const dirStr = r.direction !== null && r.direction !== undefined ? r.direction : '';
    const tempStr = r.temperature !== null && r.temperature !== undefined
      ? (r.temperature >= 0 ? `+${r.temperature.toFixed(1)}` : r.temperature.toFixed(1))
      : '';
    const statusStr = r.isError ? '"ERROR (99.9m/s)"' : '"OK"';

    rows.push([timeStr, speedAvgStr, speedMinStr, speedMaxStr, speedMedStr, dirStr, tempStr, statusStr].join(','));
  }

  const csvContent = BOM + rows.join('\r\n');
  triggerCsvDownload(csvContent, filenamePrefix);
}
