/**
 * digital-clock.js
 * 24時間表記のデジタル時計コンポーネント
 */

export class DigitalClock {
  /**
   * @param {HTMLElement} containerElement
   */
  constructor(containerElement) {
    this.container = containerElement;
    this.timer = null;
    this.render();
    this.start();
  }

  render() {
    this.container.innerHTML = `
      <div class="digital-clock-widget">
        <div class="clock-date" id="clock-date">----/--/-- (---)</div>
        <div class="clock-time" id="clock-time">00:00:00</div>
      </div>
    `;
    this.dateEl = this.container.querySelector('#clock-date');
    this.timeEl = this.container.querySelector('#clock-time');
    this.update();
  }

  start() {
    this.timer = setInterval(() => this.update(), 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  update() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const date = pad(now.getDate());

    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayName = days[now.getDay()];

    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());

    if (this.dateEl) {
      this.dateEl.textContent = `${year}/${month}/${date} (${dayName})`;
    }
    if (this.timeEl) {
      this.timeEl.textContent = `${hours}:${minutes}:${seconds}`;
    }
  }
}
