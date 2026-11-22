let playlist = [];
let presetsData = {};
let currentPlaylistIdx = 0;
let isEditing = false;

function logMsg(msg, isErr) {
  const el = document.getElementById('debugLog');
  if (!el) return;
  el.style.color = isErr ? '#ff4444' : '#0f0';
  el.innerText = msg;
}

function api(path) {
  return document.getElementById('espHost').value.replace(/\/$/, '') + path;
}

async function loadPresets() {
  try {
    const r = await fetch(api('/getPresets'));
    const a = await r.json();
    presetsData = {};
    a.forEach(p => { presetsData[p.name] = p; });
  } catch (e) {}
}

async function loadPlaylist() {
  try {
    const r = await fetch(api('/playlist'));
    playlist = await r.json();
    renderPlaylist();
  } catch (e) {}
}

function savePlaylist() {
  fetch(api('/playlist'), { method: 'POST', body: JSON.stringify(playlist) });
}

function playlistStart() { fetch(api('/playlistStart'), { method: 'POST' }); }
function playlistStop() { fetch(api('/playlistStop'), { method: 'POST' }); }
function skipNext() { fetch(api('/playlistSkip'), { method: 'POST' }).then(fetchState); }

function renderPlaylist() {
  const container = document.getElementById('playlistSteps');
  container.innerHTML = '';
  playlist.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'playlistItem';
    if (index === currentPlaylistIdx) row.classList.add('active-item');

    if (presetsData[item.presetName] && presetsData[item.presetName].steps) {
      const steps = presetsData[item.presetName].steps;
      let total = 0;
      steps.forEach(s => total += (s.duration + s.fadeDuration));
      if (total > 0) {
        let stops = [];
        let pos = 0;
        steps.forEach(s => {
          let start = (pos / total) * 100;
          let end = ((pos + s.duration + s.fadeDuration) / total) * 100;
          stops.push("rgb(" + s.r + "," + s.g + "," + s.b + ") " + start + "% " + end + "%");
          pos += (s.duration + s.fadeDuration);
        });
        row.style.background = "linear-gradient(to right, " + stops.join(', ') + ")";
      }
    }

    const label = document.createElement('span');
    label.textContent = item.presetName;
    label.style.margin = '0 6px';
    label.style.fontWeight = 'bold';
    label.style.textShadow = '1px 1px 2px #000';
    row.appendChild(label);

    const tagSel = document.createElement('select');
    const tags = [
      { val: 'any', text: 'Any' },
      { val: 'chill', text: 'Chill' },
      { val: 'build', text: 'Build' },
      { val: 'drop', text: 'Drop' }
    ];
    tags.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.val;
      opt.textContent = t.text;
      if ((item.energyTag || 'any') === t.val) opt.selected = true;
      tagSel.appendChild(opt);
    });
    tagSel.onclick = (e) => e.stopPropagation();
    tagSel.onchange = (e) => { item.energyTag = e.target.value; savePlaylist(); };
    row.appendChild(tagSel);

    const durInput = document.createElement('input');
    durInput.type = 'number';
    durInput.value = item.duration;
    durInput.onfocus = () => { isEditing = true; };
    durInput.onblur = () => { isEditing = false; };
    durInput.onclick = (e) => e.stopPropagation();
    durInput.onchange = (e) => { item.duration = parseInt(e.target.value); savePlaylist(); };
    row.appendChild(durInput);

    const upBtn = document.createElement('button'); upBtn.innerHTML = '&#8593;'; upBtn.className = 'step-btn';
    upBtn.onclick = (e) => { e.stopPropagation(); if (index > 0) { [playlist[index-1], playlist[index]] = [playlist[index], playlist[index-1]]; renderPlaylist(); savePlaylist(); } };
    const downBtn = document.createElement('button'); downBtn.innerHTML = '&#8595;'; downBtn.className = 'step-btn';
    downBtn.onclick = (e) => { e.stopPropagation(); if (index < playlist.length - 1) { [playlist[index+1], playlist[index]] = [playlist[index], playlist[index+1]]; renderPlaylist(); savePlaylist(); } };
    const delBtn = document.createElement('button'); delBtn.innerHTML = '&#10006;'; delBtn.className = 'step-btn';
    delBtn.onclick = (e) => { e.stopPropagation(); playlist.splice(index, 1); renderPlaylist(); savePlaylist(); };

    row.ondblclick = () => {
      fetch(api('/playlistSkip?index=' + index), { method: 'POST' })
        .then(r => {
          if (r.ok) {
            currentPlaylistIdx = index;
            renderPlaylist();
          }
        })
        .catch(err => logMsg("Skip failed: " + err.message, true));
    };

    row.appendChild(upBtn); row.appendChild(downBtn); row.appendChild(delBtn);
    container.appendChild(row);
  });
}

function fetchState() {
  fetch(api('/state')).then(r => r.json()).then(d => {
    if (!isEditing && currentPlaylistIdx !== d.currentPlaylistIndex) {
      currentPlaylistIdx = d.currentPlaylistIndex;
      renderPlaylist();
    }
  }).catch(() => {});
}

// ===================== WEB AUDIO BEAT & ENERGY ENGINE =====================
let audioCtx = null, analyser = null, micStream = null, micRunning = false;
let energyHistory = [], kickTimestamps = [];
let lastKickTime = 0, lastTagTriggerTime = 0, currentEnergyZone = "any", lastSentScale = 1.0;

function syncSmartFlags() {
  const smartOn = document.getElementById('smartJumpToggle').checked ? 1 : 0;
  fetch(api("/smart?smart=" + smartOn), { method: "POST" }).catch(() => {});
}

async function toggleMic() {
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
            fetch(api("/smart?scale=" + scale.toFixed(2)), { method: "POST" }).catch(() => {});
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
        fetch(api("/smart?tag=" + detectedZone), { method: "POST" }).then(() => fetchState()).catch(() => {});
      }
    }
  }
}

loadPresets().then(() => { loadPlaylist(); });
setInterval(fetchState, 400);
