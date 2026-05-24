# Secure Jarvis AI Desktop App

This project now runs as a local desktop app.

## What Starts When You Run It

- Electron opens the desktop window.
- The built frontend loads from `dist/index.html`.
- Python starts the Flask backend from `backend/main.py`.
- The frontend talks to the backend at `http://127.0.0.1:5000`.

## First-Time Setup

```powershell
cd "C:\Python\Secure Jarvis AI agent"
npm install
pip install -r requirements.txt
```

If `pyaudio` fails on Windows, install it with a wheel or use a Python version that has a compatible PyAudio build.

## Run The Desktop App

```powershell
cd "C:\Python\Secure Jarvis AI agent"
npm run jarvis
```

## Useful Commands

```powershell
npm run dev
```

Runs only the editable frontend in a browser through Vite at `http://127.0.0.1:3001`.

```powershell
python backend/main.py
```

Runs only the Python backend.

```powershell
npm run build
```

Builds the frontend into `dist/` for a future packaged desktop app.

## Architecture

```text
Electron desktop window
        |
        v
Built frontend from dist/index.html
        |
        v
Flask + Socket.IO backend at 127.0.0.1:5000
        |
        v
Windows apps, voice, wake word, pyautogui, DeepSeek/OpenRouter
```
