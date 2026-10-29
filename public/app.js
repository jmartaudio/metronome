// Metronome: all audio is generated in the browser with the Web Audio API.
// Timing uses the "lookahead scheduler" pattern: a timer wakes every 25 ms and
// schedules any clicks due in the next 100 ms on the audio clock, which is
// sample-accurate. The timer runs in a Web Worker so it isn't throttled when
// the tab is in the background.

const MIN_BPM = 20;
const MAX_BPM = 300;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;

// Counting syllables used to label subdivision level sliders.
const SUB_NAMES = {
  2: ['&'],
  3: ['trip', 'let'],
  4: ['e', '&', 'a'],
  5: ['2', '3', '4', '5'],
  6: ['2', '3', '4', '5', '6'],
};

const defaults = {
  bpm: 120,
  beats: 4,
  accentBeat: 0,
  subdivision: 1,
  volumes: { master: 0.8, accent: 1.0, beat: 0.7, subs: [null, 0.5, 0.5, 0.5, 0.5, 0.5] },
  ramp: { on: false, target: 160, mode: 'step', amount: 2, bars: 4 },
};

const state = loadState();

// ---------- persistence ----------
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('metronome'));
    if (saved) {
      return {
        ...structuredClone(defaults),
        ...saved,
        volumes: { ...defaults.volumes, ...saved.volumes },
        ramp: { ...defaults.ramp, ...saved.ramp },
      };
    }
  } catch (_) { /* storage unavailable — fall through to defaults */ }
  return structuredClone(defaults);
}
function saveState() {
  try { localStorage.setItem('metronome', JSON.stringify(state)); } catch (_) {}
}

// ---------- audio ----------
let ctx = null;
let masterGain = null;
let timerWorker = null;
let playing = false;

let nextNoteTime = 0;
let curBeat = 0;
let curSub = 0;
let barsSinceRampStep = 0;
const drawQueue = [];

function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = state.volumes.master;
  masterGain.connect(ctx.destination);

  const workerSrc = `
    let id = null;
    onmessage = (e) => {
      if (e.data === 'start') { clearInterval(id); id = setInterval(() => postMessage('tick'), ${LOOKAHEAD_MS}); }
      else if (e.data === 'stop') { clearInterval(id); id = null; }
    };`;
  timerWorker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
  timerWorker.onmessage = scheduler;
}

// One short click. Accent is highest pitched, beats in the middle, subdivisions lowest.
function playClick(time, kind, level) {
  if (level <= 0) return;
  const freq = kind === 'accent' ? 1760 : kind === 'beat' ? 1200 : 800;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = kind === 'sub' ? 'triangle' : 'square';
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0.0001, time);
  env.gain.exponentialRampToValueAtTime(level * 0.6, time + 0.001);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
  osc.connect(env).connect(masterGain);
  osc.start(time);
  osc.stop(time + 0.05);
}

function scheduler() {
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    let kind, level;
    if (curSub === 0) {
      const isAccent = curBeat === state.accentBeat;
      kind = isAccent ? 'accent' : 'beat';
      level = isAccent ? state.volumes.accent : state.volumes.beat;
    } else {
      kind = 'sub';
      level = state.volumes.subs[curSub] ?? 0.5;
    }
    playClick(nextNoteTime, kind, level);
    drawQueue.push({ time: nextNoteTime, beat: curBeat, sub: curSub });
    advance();
  }
}

function advance() {
  const subDur = 60 / state.bpm / state.subdivision;
  nextNoteTime += subDur;

  if (state.ramp.on && state.ramp.mode === 'smooth') {
    // amount is BPM per minute; move by the share of a minute that just elapsed
    rampToward(state.ramp.amount * subDur / 60);
  }

  curSub++;
  if (curSub >= state.subdivision) {
    curSub = 0;
    curBeat++;
    if (curBeat >= state.beats) {
      curBeat = 0;
      onBarComplete();
    }
  }
}

function onBarComplete() {
  if (!state.ramp.on || state.ramp.mode !== 'step') return;
  barsSinceRampStep++;
  if (barsSinceRampStep >= state.ramp.bars) {
    barsSinceRampStep = 0;
    rampToward(state.ramp.amount);
  }
}

// Move tempo toward the ramp target by `delta` BPM without overshooting.
function rampToward(delta) {
  const target = clampBpm(state.ramp.target);
  if (state.bpm === target) return;
  const dir = target > state.bpm ? 1 : -1;
  let next = state.bpm + dir * delta;
  if ((dir > 0 && next > target) || (dir < 0 && next < target)) next = target;
  setBpm(next, { fromRamp: true });
}

function start() {
  initAudio();
  ctx.resume();
  curBeat = 0;
  curSub = 0;
  barsSinceRampStep = 0;
  drawQueue.length = 0;
  nextNoteTime = ctx.currentTime + 0.06;
  playing = true;
  timerWorker.postMessage('start');
  els.startStop.textContent = 'Stop';
  requestAnimationFrame(draw);
}

function stop() {
  playing = false;
  if (timerWorker) timerWorker.postMessage('stop');
  els.startStop.textContent = 'Start';
  drawQueue.length = 0;
  highlight(-1, -1);
}

// ---------- UI ----------
const els = {
  bpm: document.getElementById('bpm'),
  bpmValue: document.getElementById('bpmValue'),
  startStop: document.getElementById('startStop'),
  tap: document.getElementById('tap'),
  beats: document.getElementById('beats'),
  subdivision: document.getElementById('subdivision'),
  beatGrid: document.getElementById('beatGrid'),
  levels: document.getElementById('levels'),
  rampOn: document.getElementById('rampOn'),
  rampTarget: document.getElementById('rampTarget'),
  rampMode: document.getElementById('rampMode'),
  rampAmount: document.getElementById('rampAmount'),
  rampBars: document.getElementById('rampBars'),
  rampBarsLabel: document.getElementById('rampBarsLabel'),
  rampStatus: document.getElementById('rampStatus'),
};

function clampBpm(v) {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Number(v) || MIN_BPM));
}

let lastSave = 0;
function setBpm(v, { fromRamp = false } = {}) {
  state.bpm = clampBpm(v);
  els.bpmValue.textContent = Math.round(state.bpm);
  els.bpm.value = state.bpm;
  updateRampStatus();
  // The smooth ramp changes tempo on every click; don't hammer storage.
  const now = performance.now();
  if (!fromRamp || now - lastSave > 1000) { saveState(); lastSave = now; }
}

function buildBeatGrid() {
  els.beatGrid.innerHTML = '';
  for (let b = 0; b < state.beats; b++) {
    const btn = document.createElement('button');
    btn.className = 'beat' + (b === state.accentBeat ? ' accent' : '');
    btn.title = `Accent beat ${b + 1}`;
    const subs = Array.from({ length: state.subdivision - 1 }, () => '<span></span>').join('');
    btn.innerHTML = `<div class="dot">${b + 1}</div><div class="subs">${subs}</div>`;
    btn.addEventListener('click', () => {
      state.accentBeat = b;
      saveState();
      buildBeatGrid();
    });
    els.beatGrid.appendChild(btn);
  }
}

function levelRow(name, get, set) {
  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = name;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = 0; input.max = 100;
  input.value = Math.round(get() * 100);
  input.setAttribute('aria-label', `${name} volume`);
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = input.value + '%';
  input.addEventListener('input', () => {
    set(input.value / 100);
    val.textContent = input.value + '%';
    saveState();
  });
  els.levels.append(label, input, val);
}

function buildLevels() {
  els.levels.innerHTML = '';
  levelRow('Master', () => state.volumes.master, (v) => {
    state.volumes.master = v;
    if (masterGain) masterGain.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
  });
  levelRow('Accent', () => state.volumes.accent, (v) => { state.volumes.accent = v; });
  levelRow('Beats', () => state.volumes.beat, (v) => { state.volumes.beat = v; });
  const names = SUB_NAMES[state.subdivision] || [];
  names.forEach((n, i) => {
    const idx = i + 1;
    levelRow(`Sub “${n}”`, () => state.volumes.subs[idx] ?? 0.5, (v) => { state.volumes.subs[idx] = v; });
  });
}

function highlight(beat, sub) {
  [...els.beatGrid.children].forEach((btn, b) => {
    btn.classList.toggle('on', b === beat && sub === 0);
    [...btn.querySelectorAll('.subs span')].forEach((s, i) => {
      s.classList.toggle('on', b === beat && i + 1 === sub);
    });
  });
}

function draw() {
  if (!playing) return;
  let latest = null;
  while (drawQueue.length && drawQueue[0].time <= ctx.currentTime) latest = drawQueue.shift();
  if (latest) highlight(latest.beat, latest.sub);
  requestAnimationFrame(draw);
}

function updateRampStatus() {
  const r = state.ramp;
  els.rampBarsLabel.style.display = r.mode === 'step' ? '' : 'none';
  if (!r.on) { els.rampStatus.textContent = 'Off'; return; }
  const target = clampBpm(r.target);
  if (Math.round(state.bpm * 10) === Math.round(target * 10)) {
    els.rampStatus.textContent = `Target of ${target} BPM reached.`;
    return;
  }
  const dir = target > state.bpm ? 'up' : 'down';
  els.rampStatus.textContent = r.mode === 'step'
    ? `Going ${dir} ${r.amount} BPM every ${r.bars} bar${r.bars == 1 ? '' : 's'} until ${target} BPM.`
    : `Going ${dir} ${r.amount} BPM per minute until ${target} BPM.`;
}

// Tap tempo: average of the last few intervals; resets after a 2 s pause.
let taps = [];
function tap() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(Math.round(60000 / avg));
  }
}

function init() {
  for (let i = 1; i <= 12; i++) els.beats.add(new Option(i, i));
  els.beats.value = state.beats;
  els.subdivision.value = state.subdivision;
  els.rampOn.checked = state.ramp.on;
  els.rampTarget.value = state.ramp.target;
  els.rampMode.value = state.ramp.mode;
  els.rampAmount.value = state.ramp.amount;
  els.rampBars.value = state.ramp.bars;
  setBpm(state.bpm);
  buildBeatGrid();
  buildLevels();

  els.bpm.addEventListener('input', () => setBpm(els.bpm.value));
  document.querySelectorAll('.nudge').forEach((b) =>
    b.addEventListener('click', () => setBpm(Math.round(state.bpm) + Number(b.dataset.nudge))));
  els.startStop.addEventListener('click', () => (playing ? stop() : start()));
  els.tap.addEventListener('click', tap);

  els.beats.addEventListener('change', () => {
    state.beats = Number(els.beats.value);
    if (state.accentBeat >= state.beats) state.accentBeat = 0;
    if (curBeat >= state.beats) curBeat = 0;
    saveState();
    buildBeatGrid();
  });
  els.subdivision.addEventListener('change', () => {
    state.subdivision = Number(els.subdivision.value);
    if (curSub >= state.subdivision) curSub = 0;
    saveState();
    buildBeatGrid();
    buildLevels();
  });

  const onRampChange = () => {
    const wasOn = state.ramp.on;
    state.ramp = {
      on: els.rampOn.checked,
      target: clampBpm(els.rampTarget.value),
      mode: els.rampMode.value,
      amount: Math.max(0.1, Number(els.rampAmount.value) || 1),
      bars: Math.max(1, Math.round(Number(els.rampBars.value) || 1)),
    };
    if (state.ramp.on && !wasOn) barsSinceRampStep = 0;
    saveState();
    updateRampStatus();
  };
  [els.rampOn, els.rampTarget, els.rampMode, els.rampAmount, els.rampBars]
    .forEach((el) => el.addEventListener('change', onRampChange));

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range') return;
    e.preventDefault();
    playing ? stop() : start();
  });
}

init();
