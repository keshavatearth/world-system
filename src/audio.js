// Procedural ocean ambience: filtered noise surf + slow wind. No assets, pure WebAudio.
let ctx, master, started = false;

function noiseBuffer(c) {
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02; // pinkish
    d[i] = last * 3.5;
  }
  return buf;
}

export function startAmbience() {
  if (started) return;
  started = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const buf = noiseBuffer(ctx);

  // surf: lowpassed noise, amplitude swelling like waves
  const surfSrc = ctx.createBufferSource();
  surfSrc.buffer = buf; surfSrc.loop = true;
  const surfLP = ctx.createBiquadFilter();
  surfLP.type = "lowpass"; surfLP.frequency.value = 420; surfLP.Q.value = 0.4;
  const surfGain = ctx.createGain();
  surfGain.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.09;
  const lfoAmp = ctx.createGain();
  lfoAmp.gain.value = 0.3;
  lfo.connect(lfoAmp).connect(surfGain.gain);
  surfSrc.connect(surfLP).connect(surfGain).connect(master);

  // second, slower swell offset for natural interference
  const lfo2 = ctx.createOscillator();
  lfo2.frequency.value = 0.057;
  const lfo2Amp = ctx.createGain();
  lfo2Amp.gain.value = 0.18;
  lfo2.connect(lfo2Amp).connect(surfGain.gain);

  // wind: bandpassed noise with wandering center frequency
  const windSrc = ctx.createBufferSource();
  windSrc.buffer = buf; windSrc.loop = true; windSrc.playbackRate.value = 0.7;
  const windBP = ctx.createBiquadFilter();
  windBP.type = "bandpass"; windBP.frequency.value = 700; windBP.Q.value = 0.6;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.14;
  const wlfo = ctx.createOscillator();
  wlfo.frequency.value = 0.031;
  const wlfoAmp = ctx.createGain();
  wlfoAmp.gain.value = 260;
  wlfo.connect(wlfoAmp).connect(windBP.frequency);
  windSrc.connect(windBP).connect(windGain).connect(master);

  surfSrc.start(); windSrc.start(); lfo.start(); lfo2.start(); wlfo.start();
}

export function setAmbience(on) {
  if (!started && on) startAmbience();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  master.gain.linearRampToValueAtTime(on ? 0.35 : 0, ctx.currentTime + 0.8);
}
