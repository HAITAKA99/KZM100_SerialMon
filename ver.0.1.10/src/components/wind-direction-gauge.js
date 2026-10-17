/**
 * wind-direction-gauge.js
 * リアルタイム風向メーター
 *
 * 仕様:
 * - 中央に方位を表す大きな太い凹四角形型（シェブロン型）の針
 * - 円いっぱいに近く大きく描画
 * - 最短回転アルゴリズムによるなめらかな回転アニメーション
 * - 0度: 北(N), 90度: 東(E), 180度: 南(S), 270度: 西(W)
 * - 計測エラー（99.9m/s）時の警告表示
 */

export class WindDirectionGauge {
  /**
   * @param {HTMLElement} containerElement
   */
  constructor(containerElement) {
    this.container = containerElement;
    this.currentAngle = 0; // 累積角度（最短補間用）
    this.isError = false;
    this.direction = 0;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="gauge-card wind-direction-card">
        <div class="gauge-header">
          <span class="gauge-title">風向 (WIND DIRECTION)</span>
          <span class="gauge-badge" id="dir-error-badge" style="display:none;">ERROR</span>
        </div>
        <div class="gauge-body">
          <svg class="compass-svg" viewBox="0 0 300 300" width="100%" height="100%">
            <defs>
              <!-- 針のグラデーション（通常時） -->
              <linearGradient id="needleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#00f0ff" />
                <stop offset="60%" stop-color="#0088ff" />
                <stop offset="100%" stop-color="#0044aa" />
              </linearGradient>
              <!-- 針のグラデーション（エラー時） -->
              <linearGradient id="needleErrorGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#ff4444" />
                <stop offset="60%" stop-color="#cc1111" />
                <stop offset="100%" stop-color="#660000" />
              </linearGradient>
              <!-- ドロップシャドウ -->
              <filter id="needleGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#00f0ff" flood-opacity="0.5"/>
              </filter>
            </defs>

            <!-- 外枠サークル -->
            <circle cx="150" cy="150" r="114" class="compass-outer-ring" />
            <circle cx="150" cy="150" r="108" class="compass-inner-ring" />

            <!-- 目盛り線（30度ごと・10度ごと） -->
            <g class="compass-ticks">
              ${this._generateTicks()}
            </g>

            <!-- 方位ラベル (外周に配置) -->
            <!-- 主要4方位 (大) -->
            <text x="150" y="16" class="compass-label major-label label-n">N</text>
            <text x="284" y="150" class="compass-label major-label label-e">E</text>
            <text x="150" y="284" class="compass-label major-label label-s">S</text>
            <text x="16" y="150" class="compass-label major-label label-w">W</text>

            <!-- 4副方位 (中) -->
            <text x="241" y="60" class="compass-label minor-label">NE</text>
            <text x="241" y="241" class="compass-label minor-label">SE</text>
            <text x="59" y="241" class="compass-label minor-label">SW</text>
            <text x="59" y="60" class="compass-label minor-label">NW</text>

            <!-- 角度ラベル (0°, 90°, 180°, 270°) -->
            <text x="150" y="32" class="compass-deg-label">0°</text>
            <text x="268" y="150" class="compass-deg-label">90°</text>
            <text x="150" y="268" class="compass-deg-label">180°</text>
            <text x="32" y="150" class="compass-deg-label">270°</text>

            <!-- シェブロン型（凹四角形）針 -->
            <!-- 中心 (150, 150) を軸に回転 -->
            <g id="compass-needle-group" style="transform-origin: 150px 150px; transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);">
              <!-- 凹四角形（シェブロン）: 先端 (150, 54), 右翼端 (200, 212), 凹み底 (150, 181), 左翼端 (100, 212) -->
              <polygon
                id="compass-needle"
                points="150,54 200,212 150,181 100,212"
                fill="url(#needleGrad)"
                stroke="#ffffff"
                stroke-width="2.5"
                filter="url(#needleGlow)"
              />
              <!-- 針の中央分割線（立体感向上） -->
              <polygon
                id="compass-needle-half"
                points="150,54 200,212 150,181"
                fill="rgba(255, 255, 255, 0.2)"
              />
              <!-- 中心ピボット -->
              <circle cx="150" cy="150" r="8" fill="#0b1329" stroke="#00f0ff" stroke-width="2.5" />
              <circle cx="150" cy="150" r="3" fill="#ffffff" />
            </g>
          </svg>
        </div>

        <div class="gauge-footer">
          <div class="gauge-value-display dir-value-display">
            <div class="dir-main-val">
              <span class="value-number" id="dir-deg-text">---</span>
              <span class="value-unit">°</span>
            </div>
            <span class="value-sub dir-name-label" id="dir-name-text">--</span>
          </div>
        </div>
      </div>
    `;

    this.needleGroup = this.container.querySelector('#compass-needle-group');
    this.needlePolygon = this.container.querySelector('#compass-needle');
    this.degText = this.container.querySelector('#dir-deg-text');
    this.nameText = this.container.querySelector('#dir-name-text');
    this.errorBadge = this.container.querySelector('#dir-error-badge');
  }

  /**
   * 目盛り線を生成（360度、10度刻み・30度刻み）
   * @private
   */
  _generateTicks() {
    const ticks = [];
    const cx = 150;
    const cy = 150;
    const rOuter = 108;

    for (let deg = 0; deg < 360; deg += 10) {
      const isMajor = deg % 30 === 0;
      const tickLength = isMajor ? 8 : 4;
      const rInner = rOuter - tickLength;
      const rad = ((deg - 90) * Math.PI) / 180;

      const x1 = (cx + rOuter * Math.cos(rad)).toFixed(1);
      const y1 = (cy + rOuter * Math.sin(rad)).toFixed(1);
      const x2 = (cx + rInner * Math.cos(rad)).toFixed(1);
      const y2 = (cy + rInner * Math.sin(rad)).toFixed(1);

      ticks.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${isMajor ? '#617d98' : '#334e68'}" stroke-width="${isMajor ? 2 : 1}" />`
      );
    }
    return ticks.join('\n');
  }

  /**
   * 角度から16方位名称を取得
   * @param {number} deg
   * @returns {string}
   */
  _degToCompassName(deg) {
    const directions = [
      '北 (N)', '北北東 (NNE)', '北東 (NE)', '東北東 (ENE)',
      '東 (E)', '東南東 (ESE)', '南東 (SE)', '南南東 (SSE)',
      '南 (S)', '南南西 (SSW)', '南西 (SW)', '西南西 (WSW)',
      '西 (W)', '西北西 (WNW)', '北西 (NW)', '北北西 (NNW)'
    ];
    const index = Math.round((deg % 360) / 22.5) % 16;
    return directions[index];
  }

  /**
   * 風向データを更新
   * @param {object} packet
   */
  update(packet) {
    if (!packet || !packet.isValid) return;

    this.isError = packet.isError;
    this.direction = packet.direction;

    if (this.isError) {
      // エラー時の表示
      if (this.errorBadge) this.errorBadge.style.display = 'inline-block';
      if (this.needlePolygon) {
        this.needlePolygon.setAttribute('fill', 'url(#needleErrorGrad)');
        this.needlePolygon.setAttribute('stroke', '#ff6666');
      }
      if (this.degText) {
        this.degText.textContent = 'ERR';
        this.degText.classList.add('error-text');
      }
      if (this.nameText) this.nameText.textContent = '計測エラー';
      return;
    }

    // 正常時
    if (this.errorBadge) this.errorBadge.style.display = 'none';
    if (this.needlePolygon) {
      this.needlePolygon.setAttribute('fill', 'url(#needleGrad)');
      this.needlePolygon.setAttribute('stroke', '#ffffff');
    }
    if (this.degText) {
      this.degText.textContent = String(this.direction).padStart(3, '0');
      this.degText.classList.remove('error-text');
    }
    if (this.nameText) {
      this.nameText.textContent = this._degToCompassName(this.direction);
    }

    // 最短角度でなめらかに回転
    const targetDeg = this.direction;
    const currentModulo = ((this.currentAngle % 360) + 360) % 360;
    let diff = (targetDeg - currentModulo + 540) % 360 - 180;
    this.currentAngle += diff;

    if (this.needleGroup) {
      this.needleGroup.style.transform = `rotate(${this.currentAngle}deg)`;
    }
  }
}
