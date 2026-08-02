/**
 * alertSound — shared alert audio utility.
 *
 * Extracted so the repeat engine and any other module can reuse the same
 * Web Audio synthesis without importing from charts.tsx (a page component).
 */

export function playAlertSound(type: "up" | "down" | "neutral" = "neutral") {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    const freqs =
      type === "up"   ? [523.25, 659.25, 783.99] :
      type === "down" ? [783.99, 659.25, 523.25]  :
                        [659.25, 783.99];
    let time = ctx.currentTime;
    for (const freq of freqs) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.18, time + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      osc.start(time);
      osc.stop(time + 0.2);
      time += 0.12;
    }
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* audio not supported — silently ignore */
  }
}
