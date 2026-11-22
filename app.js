function logMsg(msg, isErr) {
  const el = document.getElementById('debugLog');
  if (!el) return;
  el.style.color = isErr ? '#ff4444' : '#0f0';
  el.innerText = msg;
}

window.onerror = function(msg, url, line) {
  logMsg('JS ERROR (Line ' + line + '): ' + msg, true);
};

logMsg('app.js loaded cleanly! Initializing...');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(e => logMsg('SW err: ' + e.message, true));
}

let state = { effect:0, brightness:128, solidR:255, solidG:255, solidB:255, rainbowSpeed:5, propagationMode:false, steps:[], currentPlaylistIndex:0 };
let presets = [];
let playlist = [];

function api(path) {
  return document.getElementById('espIp').value.replace(/\/$/, '') + path;
}

function hexToRgb(h) {
  return [parseInt(h.substr(1,2),16), parseInt(h.substr(3,2),16), parseInt(h.substr(5,2),16)];
}

function rgbToHex(r,g,b) {
  return "#" + [r,g,b].map(x => (x||0).toString(16).padStart(2,'0')).join('');
}

function toggleSections() {
  const e = parseInt(document.getElementById('effect').value);
  document.getElementById('solidBox').style.display = (e===0) ? "block" : "none";
  document.getElementById('rainbowBox').style.display = (e===1) ? "block" : "none";
  document.getElementById('seqBox').style.display = (e===2) ? "block" : "none";
}

function updateStepColor(i, hex) {
  const c = hexToRgb(hex);
  state.steps[i].r = c[0];
  state.steps[i].g = c[1];
  state.steps[i].b = c[2];
}

function renderSteps() {
  const stepsEl = document.getElementById('steps');
  stepsEl.innerHTML = "";
  (state.steps || []).forEach((s, i) => {
    const d = document.createElement("div");
    d.className = "step-row";
    d.innerHTML = `
      <div class="row">
        <b>Step ${i+1}</b>
        <input type="color" value="${rgbToHex(s.r,s.g,s.b)}" onchange="updateStepColor(${i}, this.value)">
        <button class="btn-red" onclick="state.steps.splice(${i},1);renderSteps()">X</button>
      </div>
      <div class="row">
        <label class="small">Hold(ms) <input type="number" min="15" max="60000" value="${s.duration}" style="width:75px" onchange="state.steps[${i}].duration=parseInt(this.value)"></label>
        <label class="small">Fade(ms) <input type="number" min="0" max="60000" value="${s.fadeDuration||0}" style="width:75px" onchange="state.steps[${i}].fadeDuration=parseInt(this.value)||0"></label>
      </div>`;
    stepsEl.appendChild(d);
  });
}

function addStep() {
  if (!state.steps) state.steps = [];
  if (state.steps.length >= 16) return alert("Max 16 steps");
  state.steps.push({r:255, g:0, b:0, duration:300, fadeDuration:100});
  renderSteps();
}

function updateGlobalBrightness() {
  state.brightness = parseInt(document.getElementById('brightness').value);
  sendState();
}

function sendState() {
  state.effect = parseInt(document.getElementById('effect').value);
  state.brightness = parseInt(document.getElementById('brightness').value);
  const c = hexToRgb(document.getElementById('solidColor').value);
  state.solidR = c[0]; state.solidG = c[1]; state.solidB = c[2];
  state.rainbowSpeed = parseInt(document.getElementById('rainbowSpeed').value);
  state.propagationMode = document.getElementById('propagationMode').checked;
  fetch(api("/state"), {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(state)}).catch(e => logMsg("Send err: " + e.message, true));
}

function applyEffect() {
  sendState();
  fetch(api("/apply"), {method:"POST"}).catch(e => logMsg("Apply err: " + e.message, true));
}

async function savePreset() {
  const name = document.getElementById('presetName').value.trim();
  if (!name) return alert("Enter preset name");
  sendState();
  await fetch(api("/savePreset?name="+encodeURIComponent(name)), {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(state)});
  document.getElementById('presetName').value = "";
  loadPresets();
}

async function deletePreset() {
  const name = document.getElementById('presetSelect').value;
  if (!name) return;
  await fetch(api("/deletePreset?name="+encodeURIComponent(name)));
  loadPresets();
}

async function loadPresets() {
  const r = await fetch(api("/getPresets"));
  presets = await r.json();
  const sel = document.getElementById('presetSelect');
  sel.innerHTML = "";
  presets.forEach(p => {
    const o = document.createElement("option");
    o.value = p.name; o.textContent = p.name;
    sel.appendChild(o);
  });
  renderPlaylist();
}

async function applySelectedPreset() {
  const name = document.getElementById('presetSelect').value;
  if (!name) return;
  await fetch(api("/applyPreset?name="+encodeURIComponent(name)));
  loadState();
}

function renderPlaylist() {
  const container = document.getElementById('playlistContainer');
  container.innerHTML = "";
  playlist.forEach((it, i) => {
    const d = document.createElement("div");
    d.className = "playlist-row" + (i === state.currentPlaylistIndex ? " active-item" : "");
    const opts = presets.map(p => `<option value="${p.name}" ${p.name===it.presetName?"selected":""}>${p.name}</option>`).join("");
    const tag = it.energyTag || "any";
    d.innerHTML = `
      <div class="row">
        <select style="flex:1;" onchange="playlist[${i}].presetName=this.value">${opts}</select>
        <select onchange="playlist[${i}].energyTag=this.value">
          <option value="any" ${tag==="any"?"selected":""}>Tag: Any</option>
          <option value="chill" ${tag==="chill"?"selected":""}>Tag: Chill/Break</option>
          <option value="build" ${tag==="build"?"selected":""}>Tag: Build</option>
          <option value="drop" ${tag==="drop"?"selected":""}>Tag: Drop/High</option>
        </select>
      </div>
      <div class="row">
        <label class="small" style="margin:0;">Duration(ms): <input type="number" value="${it.duration}" style="width:85px;" onchange="playlist[${i}].duration=parseInt(this.value)"></label>
        <button class="btn-blue" onclick="jumpToIndex(${i})">Play</button>
        <button class="btn-red" onclick="playlist.splice(${i},1);renderPlaylist()">X</button>
      </div>`;
    container.appendChild(d);
  });
}

function addPlaylistRow() {
  if (presets.length === 0) return alert("Create presets first");
  playlist.push({presetName: presets[0].name, duration: 10000, energyTag: "any"});
  renderPlaylist();
}

async function savePlaylist() {
  await fetch(api("/playlist"), {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(playlist)});
  alert("Smart Playlist Saved!");
}

async function loadPlaylist() {
  const r = await fetch(api("/playlist"));
  playlist = await r.json();
  renderPlaylist();
}

async function startPlaylist() { await fetch(api("/playlistStart"), {method:"POST"}); }
async function stopPlaylist() { await fetch(api("/playlistStop"), {method:"POST"}); }
async function skipNext() { await fetch(api("/playlistSkip"), {method:"POST"}); loadState(); }
async function jumpToIndex(idx) { await fetch(api("/playlistSkip?index="+idx), {method:"POST"}); loadState(); }

async function loadState() {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 2500);
    const r = await fetch(api("/state"), { signal: controller.signal });
    clearTimeout(tid);
    const s = await r.json();

    document.getElementById('connStatus').innerText = "Connected";
    document.getElementById('connStatus').style.color = "#28a745";
    logMsg("Synced with Master ESP32 (" + api("") + ")");

    const idxChanged = (state.currentPlaylistIndex !== s.currentPlaylistIndex);
    state = s;
    document.getElementById('effect').value = state.effect;
    document.getElementById('brightness').value = state.brightness;
    document.getElementById('bval').innerText = state.brightness;
    document.getElementById('solidColor').value = rgbToHex(state.solidR,state.solidG,state.solidB);
    document.getElementById('rainbowSpeed').value = state.rainbowSpeed;
    document.getElementById('rval').innerText = state.rainbowSpeed;
    document.getElementById('propagationMode').checked = state.propagationMode || false;
    toggleSections();
    renderSteps();
    if (idxChanged) renderPlaylist();
  } catch (e) {
    document.getElementById('connStatus').innerText = "Disconnected";
    document.getElementById('connStatus').style.color = "#dc3545";
    logMsg("ESP32 fetch failed: " + e.name + " - " + e.message, true);
  }
}

async function loadAll() {
  await loadState();
  await loadPresets();
  await loadPlaylist();
}

// ===================== WEB AUDIO BEAT & ENERGY ENGINE =====================
let audioCtx = null, analyser = null, micStream = null, micRunning = false;
let energyHistory = [], kickTimestamps = [];
let lastKickTime = 0, lastTagTriggerTime = 0, currentEnergyZone = "any", lastSentScale = 1.0;

function syncSmartFlags() {
  const smartOn = document.getElementById('smartJumpToggle').checked ? 1 : 0;
  fetch(api(`/smart?smart=${smartOn}`), {method:"POST"}).catch(()=>{});
}

async function toggleMic() {
  logMsg("Requesting mic access...");
  const btn = document.getElementById('micBtn');
  if (micRunning) {
    micRunning = false;
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (audioCtx) audioCtx.close();
    btn.innerText = "Start Mic Listener";
    btn.className = "btn-green";
    document.getElementById('energyLabel').innerText = "IDLE";
    logMsg("Mic stopped.");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    logMsg("Mic API unavailable (check HTTPS)", true);
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);
    const filter = audioCtx.createBiquadFilter();
filter.type = "lowpass";
filter.frequency.value = 120;
filter.Q.value = 1.2;
analyser = audioCtx.createAnalyser();
analyser.fftSize = 512;
source.connect(filter);
filter.connect(analyser);
micRunning = true;
btn.innerText = "Stop Mic Listener";
btn.className = "btn-red";
energyHistory = [];
kickTimestamps = [];
logMsg("Mic active! Listening for 120Hz kicks...");
audioLoop();
} catch (err) {
logMsg("Mic error: " + err.name + " - " + err.message, true);
}
}
function audioLoop() {
if (!micRunning) return;
requestAnimationFrame(audioLoop);
const data = new Uint8Array(analyser.frequencyBinCount);
analyser.getByteTimeDomainData(data);
let sumSq = 0;
for (let i = 0; i < data.length; i++) {
const norm = (data[i] - 128) / 128;
sumSq += norm * norm;
}
const rms = Math.sqrt(sumSq / data.length);
energyHistory.push(rms);
if (energyHistory.length > 360) energyHistory.shift();
const avgEnergy = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
const meterPct = Math.min(100, Math.round((rms / Math.max(0.02, avgEnergy * 2.2)) * 100));
document.getElementById('bassMeter').style.width = meterPct + "%";
const now = performance.now();
const sensRatio = parseInt(document.getElementById('sensitivity').value) / 100;
if (rms > 0.015 && rms > avgEnergy * sensRatio && (now - lastKickTime) > 260) {
lastKickTime = now;
kickTimestamps.push(now);
if (kickTimestamps.length > 12) kickTimestamps.shift();
if (kickTimestamps.length >= 4) {
let intervals = [];
for (let i = 1; i < kickTimestamps.length; i++) {
const diff = kickTimestamps[i] - kickTimestamps[i - 1];
if (diff >= 280 && diff <= 1000) intervals.push(diff);
}
if (intervals.length >= 3) {
intervals.sort((a, b) => a - b);
const medianMs = intervals[Math.floor(intervals.length / 2)];
const bpm = Math.round(60000 / medianMs);
document.getElementById('bpmVal').innerText = bpm;
if (document.getElementById('autoTempoToggle').checked) {
const baseBpm = parseInt(document.getElementById('baseBpm').value) || 128;
const scale = Math.max(0.5, Math.min(2.0, bpm / baseBpm));
if (Math.abs(scale - lastSentScale) >= 0.04) {
lastSentScale = scale;
document.getElementById('scaleVal').innerText = scale.toFixed(2) + "x";
fetch(api(/smart?scale=${scale.toFixed(2)}), {method:"POST"}).catch(()=>{});
}
}
}
}
}
if (energyHistory.length >= 120 && (now - lastTagTriggerTime) > 5000) {
const recentAvg = energyHistory.slice(-60).reduce((a, b) => a + b, 0) / 60;
let detectedZone = "build";
if (recentAvg < avgEnergy * 0.72 || recentAvg < 0.012) {
detectedZone = "chill";
} else if (recentAvg > avgEnergy * 1.18) {
detectedZone = "drop";
}
const labelEl = document.getElementById('energyLabel');
labelEl.innerText = detectedZone.toUpperCase();
labelEl.style.color = detectedZone === "drop" ? "#dc3545" : (detectedZone === "chill" ? "#4da6ff" : "#ffc107");
if (detectedZone !== currentEnergyZone) {
currentEnergyZone = detectedZone;
if (document.getElementById('smartJumpToggle').checked) {
lastTagTriggerTime = now;
fetch(api(/smart?tag=${detectedZone}), {method:"POST"}).then(() => loadState()).catch(()=>{});
}
}
}
}
setInterval(() => { if (document.visibilityState === 'visible') loadState(); }, 2500);
loadAll();
