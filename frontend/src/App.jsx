import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://127.0.0.1:5000", {
  transports: ["websocket", "polling"],
  autoConnect: true,
});

const statusConfig = {
  sleeping: { label: "Sleeping", tone: "muted", pulse: "slow" },
  listening: { label: "Listening", tone: "green", pulse: "active" },
  heard: { label: "Heard", tone: "violet", pulse: "active" },
  active: { label: "Active", tone: "green", pulse: "active" },
  idle: { label: "Idle", tone: "cyan", pulse: "slow" },
  speaking: { label: "Speaking", tone: "cyan", pulse: "voice" },
  processing: { label: "Thinking", tone: "amber", pulse: "thinking" },
  executing: { label: "Executing", tone: "orange", pulse: "active" },
  error: { label: "Error", tone: "red", pulse: "alert" },
};

const voiceBars = [18, 34, 56, 42, 72, 48, 28, 64, 38, 82, 46, 24, 68, 52, 36, 76, 44, 30, 58, 40, 74, 50, 26, 62];

function formatClock(date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(date) {
  return date.toLocaleDateString([], {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [connected, setConnected] = useState(socket.connected);
  const [status, setStatus] = useState("sleeping");
  const [message, setMessage] = useState("Say arise to activate Jarvis.");
  const [events, setEvents] = useState([
    { status: "system", message: "Interface initialized", time: formatClock(new Date()) },
    { status: "system", message: "Waiting for backend connection", time: formatClock(new Date()) },
  ]);

  const current = statusConfig[status] || {
    label: status || "Unknown",
    tone: "cyan",
    pulse: "slow",
  };

  const isVoiceActive = ["listening", "speaking", "processing", "executing", "heard"].includes(status);

  const eventRows = useMemo(() => events.slice(0, 9), [events]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function addEvent(nextStatus, nextMessage) {
      setEvents((previous) => [
        {
          status: nextStatus,
          message: nextMessage || statusConfig[nextStatus]?.label || "Status updated",
          time: formatClock(new Date()),
        },
        ...previous,
      ].slice(0, 12));
    }

    function handleConnect() {
      setConnected(true);
      addEvent("active", "Backend connected");
    }

    function handleDisconnect() {
      setConnected(false);
      setStatus("error");
      setMessage("Backend is offline.");
      addEvent("error", "Backend disconnected");
    }

    function handleStatus(data) {
      const nextStatus = String(data?.status || "idle").toLowerCase();
      const nextMessage = data?.message || statusConfig[nextStatus]?.label || "Status updated";

      setStatus(nextStatus);
      setMessage(nextMessage);
      addEvent(nextStatus, nextMessage);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("jarvis_status", handleStatus);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("jarvis_status", handleStatus);
    };
  }, []);

  return (
    <main className={`shell tone-${current.tone}`}>
      <div className="background-grid" />
      <div className="scanline" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Secure Interface</p>
          <h1>JARVIS</h1>
        </div>

        <nav className="nav-status" aria-label="System status">
          <StatusDot active={connected} label={connected ? "Backend online" : "Backend offline"} />
          <StatusDot active={status !== "sleeping" && status !== "error"} label={current.label} />
          <StatusDot active={isVoiceActive} label="Voice link" />
        </nav>

        <div className="clock">
          <strong>{formatClock(now)}</strong>
          <span>{formatDate(now)}</span>
        </div>
      </header>

      <section className="dashboard">
        <aside className="panel stack">
          <PanelHeader title="Connection" />
          <Metric label="Socket" value={connected ? "Online" : "Offline"} tone={connected ? "green" : "red"} />
          <Metric label="Endpoint" value="127.0.0.1:5000" />
          <Metric label="Wake Word" value="arise" />
          <Metric label="AI Route" value="DeepSeek / OpenRouter" />
        </aside>

        <section className="core-stage" aria-label="Jarvis core status">
          <div className={`reactor pulse-${current.pulse}`}>
            <div className="ring ring-a" />
            <div className="ring ring-b" />
            <div className="ring ring-c" />
            <div className="ring ring-d" />
            <div className="reactor-core">
              <span>{current.label}</span>
            </div>
          </div>

          <div className="message-panel">
            <p className="eyebrow">Current Response</p>
            <h2>{message}</h2>
          </div>

          <div className={`voice-meter ${isVoiceActive ? "active" : ""}`} aria-hidden="true">
            {voiceBars.map((height, index) => (
              <span
                key={`${height}-${index}`}
                style={{
                  "--bar-height": `${height}px`,
                  "--delay": `${index * 45}ms`,
                }}
              />
            ))}
          </div>
        </section>

        <aside className="panel">
          <PanelHeader title="Timeline" />
          <div className="events">
            {eventRows.map((event, index) => (
              <article key={`${event.time}-${index}`} className="event-row">
                <span className={`event-light tone-${statusConfig[event.status]?.tone || "cyan"}`} />
                <div>
                  <strong>{event.status.toUpperCase()}</strong>
                  <p>{event.message}</p>
                </div>
                <time>{event.time}</time>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

function PanelHeader({ title }) {
  return (
    <div className="panel-header">
      <span />
      <h2>{title}</h2>
    </div>
  );
}

function Metric({ label, value, tone = "cyan" }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={`tone-text-${tone}`}>{value}</strong>
    </div>
  );
}

function StatusDot({ active, label }) {
  return (
    <div className="status-dot">
      <span className={active ? "on" : ""} />
      {label}
    </div>
  );
}
