const { app, BrowserWindow, session } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const FRONTEND_URL = "http://127.0.0.1:3001";
const BUILT_FRONTEND_PORT = 3123;
const BACKEND_STATUS_URL = "http://127.0.0.1:5000/api/status";
const isDev = !app.isPackaged;
const useViteDevServer = process.env.JARVIS_USE_VITE === "1";
const projectRoot = isDev ? path.resolve(__dirname, "..") : path.dirname(process.execPath);

let mainWindow;
let frontendServer;
const childProcesses = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    title: "Secure Jarvis AI Agent",
    backgroundColor: "#020617",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  showLoading("Starting Jarvis desktop runtime...");
}

function showLoading(message) {
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body {
            margin: 0;
            display: grid;
            min-height: 100vh;
            place-items: center;
            background: #020617;
            color: #e6fbff;
            font-family: Segoe UI, Arial, sans-serif;
          }
          main {
            width: min(520px, 86vw);
            padding: 28px;
            border: 1px solid rgba(103, 232, 249, 0.24);
            border-radius: 8px;
            background: rgba(8, 18, 32, 0.82);
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
          }
          h1 {
            margin: 0 0 10px;
            font-size: 32px;
            letter-spacing: 0.08em;
          }
          p {
            margin: 0;
            color: #9ccbd7;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>JARVIS</h1>
          <p>${message}</p>
        </main>
      </body>
    </html>
  `;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function commandFor(command) {
  if (process.platform !== "win32") {
    return command;
  }

  return command === "npm" ? "npm.cmd" : command;
}

function spawnManaged(label, command, args) {
  const child = spawn(commandFor(command), args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      JARVIS_DESKTOP: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  childProcesses.push(child);

  child.stdout.on("data", (data) => {
    process.stdout.write(`[${label}] ${data}`);
  });

  child.stderr.on("data", (data) => {
    process.stderr.write(`[${label}] ${data}`);
  });

  child.on("error", (error) => {
    process.stderr.write(`[${label}] failed to start: ${error.message}\n`);
  });

  child.on("exit", (code, signal) => {
    process.stdout.write(`[${label}] exited with code ${code ?? "null"} signal ${signal ?? "null"}\n`);
  });

  return child;
}

function requestOk(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 1500 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await requestOk(url)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function ensureBackend() {
  if (await requestOk(BACKEND_STATUS_URL)) {
    return;
  }

  const pythonCommand = process.env.JARVIS_PYTHON || "python";
  spawnManaged("backend", pythonCommand, ["backend/main.py"]);
}

async function ensureFrontend() {
  if (!useViteDevServer) {
    return true;
  }

  if (await requestOk(FRONTEND_URL)) {
    return true;
  }

  spawnManaged("frontend", "npm", ["run", "dev"]);
  return waitForUrl(FRONTEND_URL, 60000);
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  }[extension] || "application/octet-stream";
}

function serveBuiltFrontend(distDir) {
  return new Promise((resolve, reject) => {
    if (frontendServer) {
      resolve(`http://127.0.0.1:${frontendServer.address().port}/`);
      return;
    }

    frontendServer = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const safePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
      const requestedPath = path.normalize(path.join(distDir, safePath || "index.html"));
      const filePath = requestedPath.startsWith(distDir) && fs.existsSync(requestedPath)
        ? requestedPath
        : path.join(distDir, "index.html");

      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        response.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
        response.end(data);
      });
    });

    frontendServer.on("error", reject);
    frontendServer.listen(BUILT_FRONTEND_PORT, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${BUILT_FRONTEND_PORT}/`);
    });
  });
}

async function loadFrontend() {
  showLoading("Starting Python backend...");
  await ensureBackend();

  if (useViteDevServer) {
    showLoading("Starting Vite frontend...");
    const frontendReady = await ensureFrontend();

    if (!frontendReady) {
      showLoading("Frontend did not start on http://127.0.0.1:3001. Run npm install, then npm run jarvis.");
      return;
    }

    await mainWindow.loadURL(FRONTEND_URL);
    return;
  }

  const builtFrontendPath = path.join(projectRoot, "dist", "index.html");

  if (!fs.existsSync(builtFrontendPath)) {
    showLoading("Frontend build is missing. Run npm run build, then npm run jarvis.");
    return;
  }

  showLoading("Loading Jarvis frontend...");
  const frontendUrl = await serveBuiltFrontend(path.dirname(builtFrontendPath));
  await mainWindow.loadURL(frontendUrl);
}

function stopProcessTree(child) {
  if (!child || child.killed || !child.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGTERM");
}

function cleanup() {
  for (const child of childProcesses) {
    stopProcessTree(child);
  }

  if (frontendServer) {
    frontendServer.close();
    frontendServer = null;
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isJarvisWindow = mainWindow && webContents.id === mainWindow.webContents.id;
    const wantsMicrophone = permission === "media" && details?.mediaTypes?.includes("audio");

    callback(Boolean(isJarvisWindow && wantsMicrophone));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const isJarvisWindow = mainWindow && webContents.id === mainWindow.webContents.id;
    return Boolean(isJarvisWindow && permission === "media");
  });

  createWindow();
  await loadFrontend();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      loadFrontend();
    }
  });
});

app.on("before-quit", cleanup);

app.on("window-all-closed", () => {
  cleanup();

  if (process.platform !== "darwin") {
    app.quit();
  }
});
