const tickDurationSeconds = 0.06;
const maxTickVolume = 0.25;

export function createTickSamples(sampleRate: number): Float32Array {
  const sampleCount = Math.floor(sampleRate * tickDurationSeconds);
  const attackSamples = Math.max(1, Math.floor(sampleRate * 0.002));
  const decaySamples = Math.max(1, sampleCount - attackSamples);
  const impulseSamples = Math.floor(sampleRate * 0.0015);
  const samples = new Float32Array(sampleCount);
  let previousNoise = 0;
  let seed = 0x2f6e2b1;

  for (let index = 0; index < sampleCount; index += 1) {
    const envelope =
      index < attackSamples
        ? index / attackSamples
        : Math.max(0, 1 - (index - attackSamples) / decaySamples) ** 2;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const whiteNoise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    const highPassNoise = whiteNoise - previousNoise;
    previousNoise = whiteNoise;
    const impulse = index < impulseSamples ? 12_000 : 0;
    const value = (impulse + 7_000 * highPassNoise * envelope) / 32_767;
    samples[index] = Math.max(-1, Math.min(1, value));
  }

  return samples;
}

export class TickSoundPlayer {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;

  async prepare(): Promise<void> {
    if (typeof AudioContext === "undefined") throw new Error("audio-context-unavailable");
    this.context ??= new AudioContext();
    if (!this.buffer) {
      const samples = createTickSamples(this.context.sampleRate);
      const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.buffer = buffer;
    }
    if (this.context.state !== "running") await this.context.resume();
  }

  play(volumePercent: number): void {
    if (!this.context || !this.buffer || this.context.state !== "running") return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const normalized = Math.max(0, Math.min(100, volumePercent)) / 100;
    gain.gain.value = normalized * maxTickVolume;
    source.buffer = this.buffer;
    source.connect(gain);
    gain.connect(this.context.destination);
    source.start();
  }

  close(): void {
    const context = this.context;
    this.context = null;
    this.buffer = null;
    if (context) void context.close().catch(() => undefined);
  }
}
