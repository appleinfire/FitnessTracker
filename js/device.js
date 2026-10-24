// Не даём экрану погаснуть и подаём звуковые сигналы.

export class KeepAwake {
  constructor(fallbackVideo) {
    this.video = fallbackVideo;
    this.lock = null;
    this.active = false;
    document.addEventListener('visibilitychange', () => {
      if (this.active && document.visibilityState === 'visible') this.enable();
    });
  }

  async enable() {
    this.active = true;
    if ('wakeLock' in navigator) {
      try {
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', () => { this.lock = null; });
        return 'wakelock';
      } catch (err) {
        console.warn('Wake Lock не сработал, включаю запасной вариант', err);
      }
    }
    // Запасной вариант: беззвучное видео по кругу — Safari не гасит экран,
    // пока на странице играет видео.
    try {
      await this.video.play();
      return 'video';
    } catch (err) {
      console.warn('Запасной вариант тоже не сработал', err);
      return 'none';
    }
  }

  disable() {
    this.active = false;
    if (this.lock) this.lock.release().catch(() => {});
    this.lock = null;
    this.video.pause();
  }
}

export class Sound {
  constructor() {
    this.ctx = null;
  }

  // Вызывать из обработчика нажатия: iOS разрешает звук только после касания.
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && AC) this.ctx = new AC();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  beep(freq = 880, ms = 120, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }

  say(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    u.rate = 1.1;
    speechSynthesis.speak(u);
  }
}
