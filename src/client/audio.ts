// Sonido del juego: música de fondo tipo chiptune (sintetizada, sin archivos) y efectos.
const KEY = 'grid.sonido';

type Listener = (on: boolean) => void;

class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private listeners = new Set<Listener>();
  private unlocked = false;
  /** pista: «main» (juego) o «calm» (sala de espera: más lenta y suave) */
  private track: 'main' | 'calm' = 'main';

  constructor() {
    try { this.enabled = localStorage.getItem(KEY) !== '0'; } catch { /* nada */ }
    const unlock = () => {
      this.unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      if (this.enabled) this.startMusic();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? '1' : '0'); } catch { /* nada */ }
    if (this.enabled) { this.unlocked = true; this.startMusic(); this.blip(880); } else this.stopMusic();
    this.listeners.forEach((f) => f(this.enabled));
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.0;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.35;
    this.sfx.connect(this.master);
    return ctx;
  }

  // ───── notas ─────
  private note(dest: GainNode, freq: number, t: number, dur: number, type: OscillatorType, vol: number, slide = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dest: GainNode, t: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    src.connect(hp); hp.connect(g); g.connect(dest);
    src.start(t);
  }

  // ───── música: bucle de 4 compases (Do – Sol – Lam – Fa), alegre y tranquilo ─────
  private static readonly BPM = 104;
  private static readonly CHORDS = [
    [60, 64, 67, 72], // Do
    [55, 59, 62, 67], // Sol
    [57, 60, 64, 69], // Lam
    [53, 57, 60, 65], // Fa
  ];
  private static readonly ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 1, 3, 2];
  private static readonly MELODY = [
    [76, -1, 74, -1, 72, -1, 74, 76, -1, -1, 79, -1, 76, -1, -1, -1],
    [74, -1, 71, -1, 74, -1, 76, 74, -1, -1, 71, -1, 67, -1, -1, -1],
    [72, -1, 76, -1, 81, -1, 79, 76, -1, -1, 72, -1, 74, -1, 76, -1],
    [77, -1, 76, -1, 74, -1, 72, 69, -1, -1, 72, -1, 74, -1, -1, -1],
  ];
  private static mtof(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

  /** cambia de pista (la sala de espera usa una más tranquila) */
  setTrack(t: 'main' | 'calm'): void {
    if (this.track === t) return;
    this.track = t;
    this.step = 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.15;
  }

  // ───── pista tranquila: Fa7M – Mim7 – Rem7 – Do7M a 72 bpm, arpegios de 8 bits y melodía pentatónica ─────
  private static readonly CALM_CHORDS = [
    [53, 57, 60, 64],
    [52, 55, 59, 62],
    [50, 53, 57, 60],
    [48, 52, 55, 59],
  ];
  private static readonly CALM_ARP = [0, 2, 1, 3, 2, 1, 3, 2];
  private static readonly CALM_MEL = [
    [72, -1, -1, 69, -1, -1, 67, -1],
    [71, -1, 67, -1, -1, -1, 64, -1],
    [69, -1, -1, 72, -1, 74, -1, -1],
    [76, -1, -1, 74, -1, 72, -1, -1],
  ];

  private calmStep(tt: number, eighth: number): void {
    const m = this.music!;
    const bar = Math.floor(this.step / 8) % 4;
    const s = this.step % 8;
    const chord = Sound.CALM_CHORDS[bar];
    this.note(m, Sound.mtof(chord[Sound.CALM_ARP[s]] + 12), tt, eighth * 1.6, 'triangle', 0.07);
    if (s === 0) {
      this.note(m, Sound.mtof(chord[0] - 12), tt, eighth * 7, 'triangle', 0.09);
      this.note(m, Sound.mtof(chord[0] - 24), tt, 0.18, 'sine', 0.12, 0.5);
    }
    if (s === 4) this.note(m, Sound.mtof(chord[2] - 12), tt, eighth * 3, 'triangle', 0.05);
    // melodía sólo en 2 de cada 4 vueltas, con eco
    const phrase = Math.floor(this.step / 32) % 4;
    const mel = Sound.CALM_MEL[(bar + phrase) % 4][s];
    if ((phrase === 1 || phrase === 3) && mel > 0) {
      this.note(m, Sound.mtof(mel), tt, eighth * 1.5, 'square', 0.022);
      this.note(m, Sound.mtof(mel), tt + eighth * 1.5, eighth * 1.2, 'square', 0.009);
    }
  }

  /** en los dispositivos de los alumnos (sala de espera) la música va aparte para no tener 30 portátiles sonando */
  musicAllowed = true;

  setMusicAllowed(on: boolean): void {
    this.musicAllowed = on;
    if (on) this.startMusic(); else this.stopMusic(true);
  }

  private startMusic(): void {
    if (!this.enabled || !this.unlocked || !this.musicAllowed) return;
    const ctx = this.ensure();
    if (!ctx) return;
    void ctx.resume();
    const t = ctx.currentTime;
    this.music!.gain.cancelScheduledValues(t);
    this.music!.gain.setValueAtTime(this.music!.gain.value, t);
    this.music!.gain.linearRampToValueAtTime(0.22, t + 1.5);
    if (this.timer) return;
    this.nextTime = t + 0.1;
    const sixteenth = 60 / Sound.BPM / 4;
    const eighth = 60 / 72 / 2;
    this.timer = window.setInterval(() => {
      if (!this.ctx) return;
      while (this.track === 'calm' && this.nextTime < this.ctx.currentTime + 0.15) {
        this.calmStep(this.nextTime, eighth);
        this.step++;
        this.nextTime += eighth;
      }
      while (this.track === 'main' && this.nextTime < this.ctx.currentTime + 0.15) {
        const bar = Math.floor(this.step / 16) % 4;
        const s = this.step % 16;
        const chord = Sound.CHORDS[bar];
        const tt = this.nextTime;
        const m = this.music!;
        // arpegio suave (onda triangular)
        this.note(m, Sound.mtof(chord[Sound.ARP[s]] + 12), tt, sixteenth * 0.9, 'triangle', 0.09);
        // bajo en negras
        if (s % 4 === 0) this.note(m, Sound.mtof(chord[0] - 24), tt, sixteenth * 3.2, 'square', 0.05);
        // melodía (sólo en las vueltas pares, para que respire)
        const verse = Math.floor(this.step / 64) % 2;
        const mel = Sound.MELODY[bar][s];
        if (verse === 1 && mel > 0) this.note(m, Sound.mtof(mel), tt, sixteenth * 1.8, 'square', 0.035);
        // hi-hat
        if (s % 4 === 2) this.noise(m, tt, 0.03, 0.05);
        this.step++;
        this.nextTime += sixteenth;
      }
    }, 25);
  }

  private stopMusic(force = false): void {
    if (!this.ctx || !this.music) return;
    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(this.music.gain.value, t);
    this.music.gain.linearRampToValueAtTime(0, t + 0.3);
    window.setTimeout(() => { if (!this.enabled || force || !this.musicAllowed) { clearInterval(this.timer); this.timer = 0; } }, 400);
  }

  // ───── efectos ─────
  private play(fn: (t: number, out: GainNode) => void): void {
    if (!this.enabled || !this.unlocked) return;
    const ctx = this.ensure();
    if (!ctx) return;
    void ctx.resume();
    fn(ctx.currentTime + 0.01, this.sfx!);
  }

  blip(f = 660): void { this.play((t, o) => this.note(o, f, t, 0.07, 'square', 0.25)); }

  run(): void { this.play((t, o) => { this.note(o, 523, t, 0.06, 'square', 0.2); this.note(o, 784, t + 0.06, 0.08, 'square', 0.2); }); }

  fail(): void {
    this.play((t, o) => {
      this.note(o, 330, t, 0.12, 'square', 0.25);
      this.note(o, 247, t + 0.13, 0.25, 'square', 0.25, 0.8);
    });
  }

  success(): void {
    this.play((t, o) => {
      [72, 76, 79, 84].forEach((m, i) => this.note(o, Sound.mtof(m), t + i * 0.08, 0.16, 'square', 0.22));
      this.note(o, Sound.mtof(88), t + 0.34, 0.45, 'triangle', 0.25);
    });
  }

  star(i: number): void {
    this.play((t, o) => {
      const base = [84, 88, 91][Math.min(2, i)];
      this.note(o, Sound.mtof(base), t, 0.25, 'triangle', 0.3);
      this.note(o, Sound.mtof(base + 12), t + 0.05, 0.3, 'sine', 0.15);
      this.noise(o, t, 0.08, 0.08);
    });
  }

  /** mano levantada: «boing» con tres campanitas (para que el profe lo oiga) */
  hand(): void {
    this.play((t, o) => {
      this.note(o, 180, t, 0.22, 'square', 0.22, 4);
      this.note(o, 720, t + 0.2, 0.2, 'triangle', 0.25, 0.6);
      [84, 88, 91].forEach((m, i) => this.note(o, Sound.mtof(m), t + 0.36 + i * 0.09, 0.18, 'square', 0.16));
      this.note(o, Sound.mtof(96), t + 0.66, 0.35, 'triangle', 0.2);
    });
  }

  /** «farmear aura»: zumbido que sube de tono (estilo transformación) y estallido */
  aura(): void {
    this.play((t, o) => {
      for (let i = 0; i < 6; i++) this.note(o, 110 * Math.pow(1.26, i), t + i * 0.32, 0.36, 'sawtooth', 0.07, 1.25);
      this.note(o, 55, t, 1.9, 'square', 0.06, 2.5);
      this.noise(o, t + 0.1, 1.6, 0.05);
      [72, 79, 84, 91].forEach((m, i) => this.note(o, Sound.mtof(m), t + 1.95 + i * 0.05, 0.3, 'square', 0.14));
      this.noise(o, t + 1.95, 0.4, 0.12);
    });
  }

  /** temporizador: tic de los últimos segundos */
  tick(last = false): void { this.play((t, o) => this.note(o, last ? 1319 : 880, t, 0.05, 'square', 0.14)); }

  /** temporizador a cero: alarma de 8 bits */
  timeUp(): void {
    this.play((t, o) => {
      for (let r = 0; r < 3; r++) {
        const b = t + r * 0.5;
        [84, 79, 84, 79].forEach((m, i) => this.note(o, Sound.mtof(m), b + i * 0.09, 0.08, 'square', 0.2));
      }
      [72, 76, 79, 84].forEach((m, i) => this.note(o, Sound.mtof(m), t + 1.6 + i * 0.1, 0.25, 'triangle', 0.25));
    });
  }

  /** emote: burbuja que explota */
  pop(): void { this.play((t, o) => this.note(o, 520, t, 0.08, 'sine', 0.25, 2.2)); }

  /** mensaje de chat: blip suave */
  chat(): void { this.play((t, o) => { this.note(o, 988, t, 0.05, 'triangle', 0.12); this.note(o, 1319, t + 0.05, 0.07, 'triangle', 0.1); }); }

  /** alguien entra: teletransporte */
  join(): void { this.play((t, o) => [60, 67, 72, 79].forEach((m, i) => this.note(o, Sound.mtof(m + 12), t + i * 0.05, 0.12, 'triangle', 0.12))); }

  /** el profe atiende a alguien */
  attend(): void { this.play((t, o) => { this.note(o, Sound.mtof(79), t, 0.1, 'square', 0.15); this.note(o, Sound.mtof(84), t + 0.1, 0.2, 'square', 0.15); }); }

  fanfare(): void {
    this.play((t, o) => {
      const seq = [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [76, 0.52], [79, 0.64], [84, 0.8]];
      for (const [m, d] of seq) this.note(o, Sound.mtof(m), t + d, d === 0.8 ? 0.7 : 0.14, 'square', 0.22);
      this.note(o, Sound.mtof(48), t + 0.8, 0.7, 'triangle', 0.3);
    });
  }
}

export const sound = new Sound();

/** botón 🔊/🔇 que se mantiene sincronizado */
export function soundButton(cls = 'tb-btn'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `${cls} snd-btn`;
  const upd = (on: boolean) => {
    b.textContent = on ? '🔊' : '🔇';
    b.title = on ? 'Silenciar música y sonidos' : 'Activar música y sonidos';
    b.setAttribute('aria-label', b.title);
  };
  upd(sound.enabled);
  const off = sound.onChange(upd);
  b.onclick = () => sound.toggle();
  // se desuscribe solo cuando el botón desaparece
  const mo = new MutationObserver(() => { if (!b.isConnected) { off(); mo.disconnect(); } });
  queueMicrotask(() => mo.observe(document.body, { childList: true, subtree: true }));
  return b;
}
