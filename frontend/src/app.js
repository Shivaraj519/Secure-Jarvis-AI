import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://127.0.0.1:5000", {
  transports: ["websocket", "polling"],
});

export default function JarvisUI() {
  const [time, setTime] = useState(new Date());

  const [status, setStatus] = useState("SLEEPING");
  const [message, setMessage] = useState("Say 'arise' to activate Jarvis");

  const [logs, setLogs] = useState([
    "AI Core Initialized",
    "Voice Recognition Ready",
    "Waiting for wake word: arise",
    "System Stable",
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    socket.on("connect", () => {
      addLog("Frontend connected to backend");
    });

    socket.on("jarvis_status", (data) => {
      const newStatus = data.status || "unknown";
      const newMessage = data.message || "";

      setStatus(newStatus.toUpperCase());
      setMessage(newMessage);

      addLog(`${newStatus.toUpperCase()}: ${newMessage}`);
    });

    socket.on("disconnect", () => {
      setStatus("BACKEND OFFLINE");
      setMessage("Backend is not connected");
      addLog("Backend disconnected");
    });

    return () => {
      socket.off("connect");
      socket.off("jarvis_status");
      socket.off("disconnect");
    };
  }, []);

  function addLog(log) {
    setLogs((prevLogs) => {
      const updatedLogs = [log, ...prevLogs];
      return updatedLogs.slice(0, 8);
    });
  }

  function getStatusColor() {
    if (status.includes("LISTENING")) return "text-green-400";
    if (status.includes("SPEAKING")) return "text-cyan-300";
    if (status.includes("PROCESSING")) return "text-yellow-300";
    if (status.includes("EXECUTING")) return "text-orange-300";
    if (status.includes("ACTIVE")) return "text-green-300";
    if (status.includes("HEARD")) return "text-purple-300";
    if (status.includes("IDLE")) return "text-cyan-400";
    if (status.includes("SLEEPING")) return "text-gray-400";
    if (status.includes("ERROR")) return "text-red-400";
    if (status.includes("OFFLINE")) return "text-red-500";
    return "text-cyan-400";
  }

  function getCoreAnimation() {
    if (status.includes("LISTENING")) {
      return "animate-pulse shadow-[0_0_100px_lime]";
    }

    if (status.includes("SPEAKING")) {
      return "animate-ping shadow-[0_0_100px_cyan]";
    }

    if (status.includes("PROCESSING")) {
      return "animate-spin shadow-[0_0_100px_yellow]";
    }

    if (status.includes("EXECUTING")) {
      return "animate-pulse shadow-[0_0_100px_orange]";
    }

    if (status.includes("SLEEPING")) {
      return "opacity-40";
    }

    return "animate-pulse";
  }

  const isVoiceActive =
    status.includes("LISTENING") ||
    status.includes("SPEAKING") ||
    status.includes("PROCESSING") ||
    status.includes("EXECUTING");

  return (
    <div className="min-h-screen bg-black overflow-hidden text-cyan-300 relative font-sans">
      {/* Background Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,255,255,0.18),transparent_60%)]"></div>

      {/* Grid Overlay */}
      <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(0,255,255,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.15)_1px,transparent_1px)] bg-[size:50px_50px]"></div>

      {/* Top Navbar */}
      <div className="relative z-10 flex justify-between items-center px-10 py-5 border-b border-cyan-500/20 backdrop-blur-md">
        <div>
          <h1 className="text-4xl tracking-[0.3em] font-bold text-cyan-300 drop-shadow-[0_0_15px_cyan]">
            JARVIS AI
          </h1>
          <p className="text-cyan-500 text-sm mt-1">Created by Shivaraj</p>
        </div>

        <div className="flex gap-10 uppercase tracking-widest text-sm text-cyan-400">
          <span>System</span>
          <span>Network</span>
          <span>Voice</span>
          <span>Memory</span>
          <span>Interface</span>
        </div>

        <div className="text-right">
          <h2 className="text-5xl font-light">
            {time.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </h2>

          <p className="text-cyan-500 text-sm">
            {time.toDateString()}
          </p>
        </div>
      </div>

      {/* Main Layout */}
      <div className="relative z-10 grid grid-cols-12 gap-6 p-6 h-[calc(100vh-100px)]">
        {/* Left Side */}
        <div className="col-span-3 flex flex-col gap-6">
          <Panel title="System Status">
            <div className="grid grid-cols-2 gap-4">
              {[
                ["CPU", "28%"],
                ["RAM", "41%"],
                ["GPU", "19%"],
                ["Storage", "67%"],
              ].map(([name, value]) => (
                <div
                  key={name}
                  className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4 text-center shadow-[0_0_15px_rgba(0,255,255,0.08)]"
                >
                  <h3 className="text-cyan-500 text-sm uppercase tracking-widest">
                    {name}
                  </h3>
                  <p className="text-3xl mt-2 text-cyan-200 font-bold">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Jarvis State">
            <div className="space-y-4">
              <div>
                <p className="text-cyan-500 text-sm">Current Status</p>
                <h2 className={`text-3xl font-bold mt-2 ${getStatusColor()}`}>
                  {status}
                </h2>
              </div>

              <div>
                <p className="text-cyan-500 text-sm">Message</p>
                <p className="text-cyan-100 mt-2 text-sm leading-relaxed">
                  {message}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="AI Memory">
            <div className="space-y-3 text-cyan-200 text-sm">
              <p>• Name: Shivaraj</p>
              <p>• Wake Word: arise</p>
              <p>• Voice Recognition Enabled</p>
              <p>• Backend Status Synced</p>
            </div>
          </Panel>
        </div>

        {/* Center Core */}
        <div className="col-span-6 flex flex-col items-center justify-center relative">
          <div className="relative flex items-center justify-center w-[550px] h-[550px]">
            {/* Outer Rings */}
            <div className="absolute w-full h-full rounded-full border border-cyan-500/20 animate-spin"></div>
            <div className="absolute w-[500px] h-[500px] rounded-full border border-cyan-400/40 animate-pulse"></div>
            <div className="absolute w-[420px] h-[420px] rounded-full border-2 border-cyan-300 shadow-[0_0_40px_cyan] animate-spin"></div>
            <div className="absolute w-[340px] h-[340px] rounded-full border border-cyan-400/30 animate-pulse"></div>
            <div className="absolute w-[250px] h-[250px] rounded-full border-4 border-cyan-300 shadow-[0_0_80px_cyan]"></div>

            {/* Center Glow */}
            <div className={`absolute w-48 h-48 rounded-full bg-cyan-400 blur-3xl opacity-30 ${getCoreAnimation()}`}></div>

            {/* Center Text */}
            <div className="z-10 text-center">
              <h1 className="text-7xl tracking-[0.35em] text-white drop-shadow-[0_0_20px_cyan] font-thin">
                JARVIS
              </h1>

              <p className={`mt-5 tracking-widest text-xl font-bold ${getStatusColor()}`}>
                {status}
              </p>

              <p className="mt-3 text-cyan-100 text-sm max-w-md">
                {message}
              </p>
            </div>
          </div>

          {/* Voice Wave */}
          <div className="mt-10 flex gap-[3px] items-end h-24">
            {Array.from({ length: 90 }).map((_, i) => (
              <div
                key={i}
                className={`w-[3px] rounded-full ${
                  isVoiceActive ? "bg-green-400 animate-pulse" : "bg-cyan-900"
                }`}
                style={{
                  height: isVoiceActive
                    ? `${20 + Math.random() * 70}px`
                    : "20px",
                  animationDelay: `${i * 0.02}s`,
                }}
              ></div>
            ))}
          </div>

          <p className="mt-8 text-3xl text-cyan-100 tracking-wide text-center">
            {status.includes("SLEEPING")
              ? "Say arise to activate me"
              : message || "How can I help you today, Sir?"}
          </p>

          {/* Action Buttons */}
          <div className="flex gap-8 mt-10">
            {["🎤", "🌐", "🎵", "💻", "⚙️"].map((icon, index) => (
              <button
                key={index}
                className="w-16 h-16 rounded-full border border-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all duration-300 text-3xl shadow-[0_0_20px_rgba(0,255,255,0.35)]"
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        {/* Right Side */}
        <div className="col-span-3 flex flex-col gap-6">
          <Panel title="System Logs">
            <div className="space-y-4 text-sm">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className="flex justify-between border-b border-cyan-500/10 pb-2 gap-3"
                >
                  <span className="truncate">{log}</span>
                  <span className="text-cyan-500 whitespace-nowrap">
                    {new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Backend">
            <div className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span>Socket</span>
                <span className={status.includes("OFFLINE") ? "text-red-400" : "text-green-400"}>
                  {status.includes("OFFLINE") ? "Disconnected" : "Connected"}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Wake Word</span>
                <span className="text-green-400">arise</span>
              </div>

              <div className="flex justify-between">
                <span>Mode</span>
                <span className={status.includes("SLEEPING") ? "text-gray-400" : "text-green-400"}>
                  {status.includes("SLEEPING") ? "Sleeping" : "Active"}
                </span>
              </div>
            </div>
          </Panel>

          <Panel title="Voice Status">
            <div className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span>Speech Recognition</span>
                <span className={status.includes("LISTENING") ? "text-green-400" : "text-gray-400"}>
                  {status.includes("LISTENING") ? "Listening" : "Standby"}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Neural Voice</span>
                <span className={status.includes("SPEAKING") ? "text-green-400" : "text-gray-400"}>
                  {status.includes("SPEAKING") ? "Speaking" : "Idle"}
                </span>
              </div>

              <div className="flex justify-between">
                <span>AI Engine</span>
                <span className={status.includes("PROCESSING") ? "text-yellow-300" : "text-gray-400"}>
                  {status.includes("PROCESSING") ? "Thinking" : "Idle"}
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="border border-cyan-500/30 rounded-2xl p-5 bg-cyan-500/5 backdrop-blur-md shadow-[0_0_25px_rgba(0,255,255,0.15)]">
      <div className="flex items-center gap-2 mb-5 border-b border-cyan-500/20 pb-3">
        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
        <h2 className="uppercase tracking-widest text-xl text-cyan-300">
          {title}
        </h2>
      </div>

      {children}
    </div>
  );
}