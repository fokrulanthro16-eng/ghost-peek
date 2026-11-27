type SoundName =
  | "faster"
  | "slower"
  | "held"
  | "baited"
  | "countdown"
  | "roundEnd";

export class SoundEngine {
  private context: AudioContext | null = null;
  private muted = false;

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  async resume(): Promise<void> {
    const context = this.ensureContext();
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  play(name: SoundName): void {
    if (this.muted) {
      return;
    }
    const context = this.ensureContext();
    if (context.state === "suspended") {
      void context.resume();
    }

    switch (name) {
      case "faster":
        this.lockChime(context);
        break;
      case "slower":
        this.mechanicalClick(context);
        break;
      case "held":
        this.confirmTick(context);
        break;
      case "baited":
        this.lowBuzz(context);
        break;
      case "countdown":
        this.countdownTick(context);
        break;
      case "roundEnd":
        this.roundEndChord(context);
        break;
    }
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextCtor();
    }
    return this.context;
  }

  private tone(
    context: AudioContext,
    frequency: number,
    startOffset: number,
    duration: number,
    type: OscillatorType,
    gainValue: number,
    destination: AudioNode = context.destination,
  ): void {
    const now = context.currentTime + startOffset;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private lockChime(context: AudioContext): void {
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 600;
    filter.connect(context.destination);
    this.tone(context, 920, 0, 0.08, "triangle", 0.08, filter);
    this.tone(context, 1380, 0.055, 0.12, "sine", 0.075, filter);
    this.tone(context, 1840, 0.11, 0.08, "sine", 0.045, filter);
  }

  private mechanicalClick(context: AudioContext): void {
    this.tone(context, 260, 0, 0.045, "square", 0.045);
    this.tone(context, 190, 0.035, 0.055, "triangle", 0.035);
  }

  private confirmTick(context: AudioContext): void {
    this.tone(context, 720, 0, 0.05, "sine", 0.035);
    this.tone(context, 1080, 0.035, 0.055, "sine", 0.025);
  }

  private lowBuzz(context: AudioContext): void {
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.linearRampToValueAtTime(58, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  private countdownTick(context: AudioContext): void {
    this.tone(context, 520, 0, 0.045, "square", 0.038);
    this.tone(context, 1040, 0.045, 0.055, "sine", 0.028);
  }

  private roundEndChord(context: AudioContext): void {
    this.tone(context, 330, 0, 0.16, "sine", 0.035);
    this.tone(context, 495, 0.015, 0.17, "sine", 0.03);
    this.tone(context, 660, 0.03, 0.18, "triangle", 0.025);
  }
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}
