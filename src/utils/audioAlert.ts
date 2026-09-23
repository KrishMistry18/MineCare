/**
 * MineCare - Web Audio Industrial Buzzer Alert Synthesizer
 * 
 * Generates an authentic industrial piezo warning pattern (880Hz / 440Hz dual tone)
 * for the supervisor dashboard when any worker enters DANGER status.
 * Can be muted or unmuted at any time.
 */

class AudioAlertSystem {
  private audioCtx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isAlarmPlaying: boolean = false;
  private alarmInterval: ReturnType<typeof setInterval> | null = null;

  public init(): void {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.stopAlarm();
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public playTone(frequency: number = 880, durationMs: number = 200): void {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.audioCtx) return;

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);

      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + (durationMs / 1000));

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + (durationMs / 1000));
    } catch {
      // Audio autoplay policy fallback
    }
  }

  public startDangerAlarm(): void {
    if (this.isAlarmPlaying || this.isMuted) return;
    this.isAlarmPlaying = true;

    // Rapid double-beep sequence every 1.5 seconds
    const triggerBeep = () => {
      if (!this.isAlarmPlaying || this.isMuted) return;
      this.playTone(950, 150);
      setTimeout(() => {
        if (this.isAlarmPlaying && !this.isMuted) {
          this.playTone(750, 180);
        }
      }, 180);
    };

    triggerBeep();
    this.alarmInterval = setInterval(triggerBeep, 1600);
  }

  public stopAlarm(): void {
    this.isAlarmPlaying = false;
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
  }
}

export const audioAlert = new AudioAlertSystem();
