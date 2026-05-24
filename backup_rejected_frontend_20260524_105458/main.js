import { io } from "socket.io-client";
import "./styles.css";

const API_BASE = "http://127.0.0.1:5000";

const socket = io(API_BASE, {
  transports: ["websocket", "polling"],
});

const statusNames = {
  sleeping: "Sleeping",
  listening: "Listening",
  heard: "Heard",
  active: "Active",
  idle: "Idle",
  speaking: "Speaking",
  processing: "Thinking",
  executing: "Executing",
  error: "Error",
};

const weatherCodes = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

const viewOrder = ["overview", "voice", "chat"];

const state = {
  backend: false,
  status: "sleeping",
  message: "Waiting for your command.",
  activeView: "overview",
  audioLevel: 0,
  signalBoost: 0,
};

const el = {
  shell: document.getElementById("appShell"),
  canvas: document.getElementById("signalCanvas"),
  backendState: document.getElementById("backendState"),
  backendHint: document.getElementById("backendHint"),
  socketState: document.getElementById("socketState"),
  modeState: document.getElementById("modeState"),
  statusHeadline: document.getElementById("statusHeadline"),
  statusMessage: document.getElementById("statusMessage"),
  coreLabel: document.getElementById("coreLabel"),
  voiceState: document.getElementById("voiceState"),
  voiceMessage: document.getElementById("voiceMessage"),
  voiceBars: document.getElementById("voiceBars"),
  voiceSpectrum: document.getElementById("voiceSpectrum"),
  clockTime: document.getElementById("clockTime"),
  clockDate: document.getElementById("clockDate"),
  timeline: document.getElementById("timeline"),
  weatherLocation: document.getElementById("weatherLocation"),
  weatherTemp: document.getElementById("weatherTemp"),
  weatherDetails: document.getElementById("weatherDetails"),
  chatStatus: document.getElementById("chatStatus"),
  messages: document.getElementById("messages"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  clapButton: document.getElementById("clapButton"),
  clapHint: document.getElementById("clapHint"),
  viewLabel: document.getElementById("viewLabel"),
  viewTabs: [...document.querySelectorAll(".view-tab")],
};

let clapEnabled = false;
let firstClapAt = 0;
let lastClapAt = 0;
let clapStream = null;
let clapAudioContext = null;

function timeText(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fullTimeText(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function updateClock() {
  const now = new Date();
  el.clockTime.textContent = timeText(now);
  el.clockDate.textContent = now.toLocaleDateString([], {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function setBackend(connected) {
  state.backend = connected;
  el.backendState.textContent = connected ? "Online" : "Offline";
  el.backendHint.textContent = connected ? "Backend link is live." : "Start backend/main.py.";
  el.socketState.textContent = connected ? "Connected" : "Disconnected";
  el.backendState.className = connected ? "good" : "bad";
  el.socketState.className = connected ? "good" : "bad";
}

function addTimeline(status, message) {
  const row = document.createElement("article");
  row.className = `timeline-row status-${status}`;
  row.innerHTML = `
    <span></span>
    <div>
      <strong>${statusNames[status] || status || "System"}</strong>
      <p>${message || "Status updated."}</p>
    </div>
    <time>${fullTimeText(new Date())}</time>
  `;

  el.timeline.prepend(row);
  while (el.timeline.children.length > 10) {
    el.timeline.lastElementChild.remove();
  }
}

function isQuietStatus(status, message) {
  return status === "sleeping" || (status === "listening" && /wake word/i.test(message || ""));
}

function setStatus(status, message) {
  const cleanStatus = String(status || "idle").toLowerCase();
  const label = statusNames[cleanStatus] || cleanStatus;
  const cleanMessage = message || "Status updated.";
  const quiet = isQuietStatus(cleanStatus, cleanMessage);

  state.status = cleanStatus;
  state.message = cleanMessage;
  state.signalBoost = quiet ? 0 : ["speaking", "listening", "processing", "executing", "heard"].includes(cleanStatus) ? 1 : 0.35;

  el.shell.dataset.status = cleanStatus;
  el.modeState.textContent = label;
  el.statusHeadline.textContent = label;
  el.statusMessage.textContent = cleanMessage;
  el.coreLabel.textContent = label.toUpperCase();
  el.voiceState.textContent = label;
  el.voiceMessage.textContent = cleanMessage;

  addTimeline(cleanStatus, cleanMessage);
}

function setView(viewName) {
  state.activeView = viewName;
  el.shell.dataset.view = viewName;
  el.viewLabel.textContent = viewName.charAt(0).toUpperCase() + viewName.slice(1);

  el.viewTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === viewName);
  });
}

function switchViewByClap() {
  const currentIndex = viewOrder.indexOf(state.activeView);
  const nextView = viewOrder[(currentIndex + 1) % viewOrder.length];
  setView(nextView);
  addTimeline("active", `Opened ${nextView} view.`);
}

function registerClap() {
  const now = performance.now();

  if (now - firstClapAt < 650) {
    firstClapAt = 0;
    switchViewByClap();
    el.clapHint.textContent = "View switched.";
    return;
  }

  firstClapAt = now;
  el.clapHint.textContent = "First clap detected.";
}

async function enableClapSwitch() {
  if (clapEnabled) {
    disableClapSwitch();
    return;
  }

  try {
    clapStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    clapAudioContext = new AudioContext();
    const source = clapAudioContext.createMediaStreamSource(clapStream);
    const analyser = clapAudioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.25;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    let noiseFloor = 0;

    clapEnabled = true;
    el.clapButton.classList.add("active");
    el.clapButton.innerHTML = "<span></span>Stop Clap";
    el.clapHint.textContent = "Double clap changes the active view.";

    function readClaps() {
      if (!clapEnabled) return;

      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      let average = 0;

      for (let index = 0; index < samples.length; index += 1) {
        const level = Math.abs(samples[index] - 128);
        peak = Math.max(peak, level);
        average += level;
      }

      average /= samples.length;
      noiseFloor = noiseFloor * 0.84 + average * 0.16;

      const now = performance.now();
      if (peak > 62 && average > Math.max(11, noiseFloor * 2.2) && now - lastClapAt > 190) {
        lastClapAt = now;
        state.audioLevel = 1;
        registerClap();
      }

      state.audioLevel *= 0.9;
      requestAnimationFrame(readClaps);
    }

    readClaps();
  } catch (error) {
    console.error("Clap switch error:", error);
    el.clapHint.textContent = "Microphone permission is needed.";
  }
}

function disableClapSwitch() {
  clapEnabled = false;
  firstClapAt = 0;
  state.audioLevel = 0;
  el.clapButton.classList.remove("active");
  el.clapButton.innerHTML = "<span></span>Clap Switch";
  el.clapHint.textContent = "Double clap changes the active view.";

  if (clapStream) {
    clapStream.getTracks().forEach((track) => track.stop());
    clapStream = null;
  }

  if (clapAudioContext) {
    clapAudioContext.close();
    clapAudioContext = null;
  }
}

function addMessage(role, text) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.innerHTML = `<span>${role === "user" ? "You" : "Jarvis"}</span><p>${text}</p>`;
  el.messages.appendChild(message);
  el.messages.scrollTop = el.messages.scrollHeight;
  return message;
}

async function sendChat(text) {
  addMessage("user", text);
  const pending = addMessage("assistant", "Thinking...");
  el.chatStatus.textContent = "Thinking";
  setView("chat");

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    const data = await response.json();
    pending.querySelector("p").textContent = data.reply || "No reply received.";
    el.chatStatus.textContent = "Ready";
  } catch (error) {
    console.error("Chat error:", error);
    pending.querySelector("p").textContent = "Backend chat API is offline. Start backend/main.py.";
    el.chatStatus.textContent = "Offline";
  }
}

function initChat() {
  el.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;

    el.chatInput.value = "";
    sendChat(text);
  });
}

async function initWeather(lat = 12.9716, lon = 77.5946, label = "Bangalore, India") {
  try {
    el.weatherLocation.textContent = label;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia%2FKolkata`;
    const response = await fetch(url);
    const data = await response.json();
    const current = data.current;

    el.weatherTemp.textContent = `${Math.round(current.temperature_2m)} deg C`;
    el.weatherDetails.textContent = `${weatherCodes[current.weather_code] || "Live weather"} | Feels ${Math.round(current.apparent_temperature)} deg C | Humidity ${current.relative_humidity_2m}% | Wind ${Math.round(current.wind_speed_10m)} km/h`;
  } catch (error) {
    console.error("Weather error:", error);
    el.weatherTemp.textContent = "Offline";
    el.weatherDetails.textContent = "Weather needs internet access.";
  }
}

function initVoiceMeters() {
  const heights = [26, 52, 36, 68, 44, 76, 30, 58, 70, 42, 64, 34, 78, 46, 60, 28, 72, 50];
  const bars = heights.map((height, index) => `<span style="--height:${height}px;--delay:${index * 46}ms"></span>`).join("");
  el.voiceBars.innerHTML = bars;
  el.voiceSpectrum.innerHTML = bars;
}

function initCanvas() {
  const canvas = el.canvas;
  const ctx = canvas.getContext("2d");
  const nodes = Array.from({ length: 44 }, (_, index) => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0007,
    vy: (Math.random() - 0.5) * 0.0007,
    size: 1.2 + Math.random() * 2.8,
    lane: index % 5,
  }));

  let tick = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(900, Math.floor(rect.width * devicePixelRatio));
    canvas.height = Math.max(620, Math.floor(rect.height * devicePixelRatio));
  }

  function drawGrid(width, height) {
    const gap = 44 * devicePixelRatio;
    ctx.strokeStyle = "rgba(21, 19, 15, 0.08)";
    ctx.lineWidth = 1 * devicePixelRatio;

    for (let x = 0; x < width; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let y = 0; y < height; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  function draw() {
    tick += 1;
    const width = canvas.width;
    const height = canvas.height;
    const active = Math.max(state.signalBoost, state.audioLevel);
    const isError = state.status === "error";
    const isSpeaking = state.status === "speaking";

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#eee7da";
    ctx.fillRect(0, 0, width, height);
    drawGrid(width, height);

    const scanX = ((tick * (1.4 + active * 2.4)) % (width + 260 * devicePixelRatio)) - 130 * devicePixelRatio;
    const scan = ctx.createLinearGradient(scanX - 120 * devicePixelRatio, 0, scanX + 120 * devicePixelRatio, 0);
    scan.addColorStop(0, "rgba(37, 143, 133, 0)");
    scan.addColorStop(0.5, isError ? "rgba(194, 65, 12, 0.20)" : "rgba(37, 143, 133, 0.18)");
    scan.addColorStop(1, "rgba(37, 143, 133, 0)");
    ctx.fillStyle = scan;
    ctx.fillRect(scanX - 120 * devicePixelRatio, 0, 240 * devicePixelRatio, height);

    ctx.strokeStyle = "rgba(21, 19, 15, 0.18)";
    ctx.lineWidth = 1 * devicePixelRatio;
    for (let lane = 1; lane <= 5; lane += 1) {
      const y = (height / 6) * lane + Math.sin((tick + lane * 40) * 0.01) * 18 * devicePixelRatio;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 28 * devicePixelRatio) {
        const wave = Math.sin(x * 0.006 + tick * 0.018 + lane) * (6 + active * 14) * devicePixelRatio;
        if (x === 0) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }

    nodes.forEach((node, index) => {
      node.x += node.vx * (1 + active);
      node.y += node.vy * (1 + active);
      if (node.x < 0.04 || node.x > 0.96) node.vx *= -1;
      if (node.y < 0.08 || node.y > 0.92) node.vy *= -1;

      const x = node.x * width;
      const y = node.y * height;
      const pulse = 1 + Math.sin(tick * 0.04 + index) * 0.22 + active * 0.45;

      ctx.fillStyle = isError
        ? "rgba(194, 65, 12, 0.78)"
        : isSpeaking
          ? "rgba(167, 201, 87, 0.82)"
          : "rgba(37, 143, 133, 0.78)";
      ctx.beginPath();
      ctx.rect(x - node.size * pulse * devicePixelRatio, y - node.size * pulse * devicePixelRatio, node.size * 2 * pulse * devicePixelRatio, node.size * 2 * pulse * devicePixelRatio);
      ctx.fill();
    });

    ctx.strokeStyle = "rgba(217, 95, 61, 0.34)";
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.strokeRect(28 * devicePixelRatio, 28 * devicePixelRatio, width - 56 * devicePixelRatio, height - 56 * devicePixelRatio);

    requestAnimationFrame(draw);
  }

  resize();
  addEventListener("resize", resize);
  draw();
}

async function pollBackendStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/status`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    setBackend(true);

    if (!socket.connected && data?.backend === "online") {
      el.backendHint.textContent = "HTTP is online. Socket events sync when available.";
    }
  } catch {
    if (!socket.connected) {
      setBackend(false);
    }
  }
}

el.viewTabs.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewTarget));
});

el.clapButton.addEventListener("click", enableClapSwitch);

socket.on("connect", () => {
  setBackend(true);
  setStatus("active", "Frontend connected to backend.");
});

socket.on("disconnect", () => {
  setBackend(false);
  setStatus("error", "Backend offline. Start backend/main.py.");
});

socket.on("jarvis_status", (data) => {
  setStatus(data?.status, data?.message);
});

updateClock();
initChat();
initWeather();
initVoiceMeters();
initCanvas();
setView("overview");
setBackend(socket.connected);
setStatus("sleeping", "Waiting for your command.");
pollBackendStatus();

setInterval(updateClock, 1000);
setInterval(initWeather, 15 * 60 * 1000);
setInterval(pollBackendStatus, 2000);
