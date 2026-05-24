import asyncio
import ctypes
import os
import subprocess
import tempfile
import textwrap
import threading
import time
import uuid
import webbrowser
import json
from dataclasses import dataclass, field
from datetime import datetime
from ctypes import wintypes
from typing import Callable
from urllib.parse import quote, quote_plus

import cv2
import edge_tts
import psutil
import pyautogui
import pygame
import pygetwindow as gw
import requests
import speech_recognition as sr
from flask import Flask, jsonify, request
from flask_socketio import SocketIO


# =========================================
# CONFIG
# =========================================

@dataclass
class JarvisConfig:
    creator_name: str = "Shivaraj"
    assistant_name: str = "Jarvis"
    wake_words: tuple[str, ...] = ("arise", "wake up jarvis", "jarvis")
    sleep_commands: tuple[str, ...] = ("sleep jarvis", "go to sleep")
    exit_commands: tuple[str, ...] = ("exit", "shutdown jarvis", "quit jarvis")
    stop_commands: tuple[str, ...] = ("stop speaking", "stop jarvis", "shut up")
    deepseek_model: str = "deepseek-chat"
    deepseek_api_url: str = "https://api.deepseek.com/chat/completions"
    openrouter_model: str = "deepseek/deepseek-chat"
    openrouter_api_url: str = "https://openrouter.ai/api/v1/chat/completions"
    max_reply_words: int = 45
    host: str = "127.0.0.1"
    port: int = 5000
    voice_map: dict[str, str] = field(default_factory=lambda: {
        "english": "en-GB-RyanNeural",
    })
    language_code: dict[str, str] = field(default_factory=lambda: {
        "english": "en-US",
    })
    api_provider: str = "deepseek"
    deepseek_api_key: str = ""
    gemini_api_key: str = ""
    active_model: str = ""


CONFIG = JarvisConfig()
CONFIG_FILE = "backend/config.json"

def load_config_file() -> None:
    global CONFIG
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                data = json.load(f)
                CONFIG.creator_name = data.get("creator_name", CONFIG.creator_name)
                CONFIG.assistant_name = data.get("assistant_name", CONFIG.assistant_name)
                CONFIG.api_provider = data.get("api_provider", CONFIG.api_provider)
                CONFIG.deepseek_api_key = data.get("deepseek_api_key", CONFIG.deepseek_api_key)
                CONFIG.gemini_api_key = data.get("gemini_api_key", CONFIG.gemini_api_key)
                CONFIG.active_model = data.get("active_model", CONFIG.active_model)
                CONFIG.max_reply_words = int(data.get("max_reply_words", CONFIG.max_reply_words))
                voice = data.get("active_voice", "en-GB-RyanNeural")
                CONFIG.voice_map["english"] = voice
            print(f"[CONFIG] Loaded configuration from {CONFIG_FILE}")
        except Exception as e:
            print("Error loading config:", e)

def save_config_file() -> None:
    try:
        data = {
            "creator_name": CONFIG.creator_name,
            "assistant_name": CONFIG.assistant_name,
            "api_provider": CONFIG.api_provider,
            "deepseek_api_key": CONFIG.deepseek_api_key,
            "gemini_api_key": CONFIG.gemini_api_key,
            "active_model": CONFIG.active_model,
            "max_reply_words": CONFIG.max_reply_words,
            "active_voice": CONFIG.voice_map.get("english", "en-GB-RyanNeural")
        }
        with open(CONFIG_FILE, "w") as f:
            json.dump(data, f, indent=4)
        print(f"[CONFIG] Saved configuration to {CONFIG_FILE}")
    except Exception as e:
        print("Error saving config:", e)

CHAT_HISTORY: list[dict[str, str]] = []


# =========================================
# FLASK + SOCKET.IO BACKEND
# =========================================

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")


def send_status(status: str, message: str = "") -> None:
    print(f"[STATUS] {status}: {message}")
    socketio.emit("jarvis_status", {"status": status, "message": message})


@app.route("/")
def home():
    return "Jarvis backend is running"


@app.route("/api/status")
def status_api():
    return jsonify({
        "backend": "online",
        "assistant": CONFIG.assistant_name,
        "active": jarvis_active,
        "speaking": is_speaking,
        "language": CURRENT_LANGUAGE,
        "time": current_time_context(),
    })


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, DELETE"
    return response


@app.route("/api/chat", methods=["POST", "OPTIONS"])
def chat_api():
    if request.method == "OPTIONS":
        return ("", 204)

    data = request.get_json(silent=True) or {}
    message = str(data.get("message", "")).strip()

    if not message:
        return jsonify({"reply": "Type a question first."}), 400

    # 1. Check if it matches any local system command (e.g. "open notepad", "what time is it")
    send_status("processing", "Checking command...")
    if execute_command(message.lower()):
        send_status("idle", "Command executed")
        return jsonify({"reply": "Command executed successfully."})

    # 2. Otherwise, route to the selected AI model
    send_status("processing", "Answering typed question...")
    reply = get_ai_response(message)
    send_status("idle", "Typed answer ready")

    # Speak the AI response asynchronously in a daemon thread so it doesn't block the API response!
    threading.Thread(target=speak_sync, args=(reply,), daemon=True).start()

    return jsonify({"reply": reply})


@app.route("/api/settings", methods=["GET", "POST", "OPTIONS"])
def settings_api():
    global CONFIG
    if request.method == "OPTIONS":
        return ("", 204)
        
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        CONFIG.creator_name = data.get("creator_name", CONFIG.creator_name)
        CONFIG.assistant_name = data.get("assistant_name", CONFIG.assistant_name)
        CONFIG.api_provider = data.get("api_provider", CONFIG.api_provider)
        CONFIG.deepseek_api_key = data.get("deepseek_api_key", CONFIG.deepseek_api_key)
        CONFIG.gemini_api_key = data.get("gemini_api_key", CONFIG.gemini_api_key)
        CONFIG.active_model = data.get("active_model", CONFIG.active_model)
        
        try:
            CONFIG.max_reply_words = int(data.get("max_reply_words", CONFIG.max_reply_words))
        except ValueError:
            pass
            
        voice = data.get("active_voice", CONFIG.voice_map.get("english", "en-GB-RyanNeural"))
        CONFIG.voice_map["english"] = voice
        save_config_file()
        return jsonify({"status": "success", "message": "Settings updated"})
    
    return jsonify({
        "creator_name": CONFIG.creator_name,
        "assistant_name": CONFIG.assistant_name,
        "api_provider": getattr(CONFIG, "api_provider", "deepseek"),
        "deepseek_api_key": getattr(CONFIG, "deepseek_api_key", ""),
        "gemini_api_key": getattr(CONFIG, "gemini_api_key", ""),
        "active_model": getattr(CONFIG, "active_model", ""),
        "max_reply_words": CONFIG.max_reply_words,
        "active_voice": CONFIG.voice_map.get("english", "en-GB-RyanNeural")
    })


@app.route("/api/launch_app", methods=["POST", "OPTIONS"])
def launch_app_api():
    if request.method == "OPTIONS":
        return ("", 204)
        
    data = request.get_json(silent=True) or {}
    app_name = data.get("app", "").lower().strip()
    
    launch_commands = {
        "notepad": "notepad",
        "calculator": "calc",
        "vscode": "code",
        "spotify": "start spotify",
        "chrome": "start chrome",
        "edge": "start msedge",
        "camera": "start microsoft.windows.camera:"
    }
    
    if app_name in launch_commands:
        command = launch_commands[app_name]
        try:
            subprocess.Popen(command, shell=True)
            remember_opened_app(app_name)
            speak_sync(f"Opening {app_name}")
            return jsonify({"status": "success", "message": f"Launched {app_name}"})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Failed to launch: {e}"}), 500
            
    return jsonify({"status": "error", "message": f"App {app_name} not recognized"}), 400


@app.route("/api/memories", methods=["GET", "POST", "DELETE", "OPTIONS"])
def memories_api():
    if request.method == "OPTIONS":
        return ("", 204)
        
    memory_file = "backend/memory.json"
    
    # Ensure memory file exists
    if not os.path.exists(memory_file):
        try:
            with open(memory_file, "w") as f:
                json.dump({"memories": []}, f)
        except Exception:
            pass
            
    try:
        with open(memory_file, "r") as f:
            mem_data = json.load(f)
    except Exception:
        mem_data = {"memories": []}
        
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        new_memory = data.get("memory", "").strip()
        if new_memory:
            if new_memory not in mem_data["memories"]:
                mem_data["memories"].append(new_memory)
                try:
                    with open(memory_file, "w") as f:
                        json.dump(mem_data, f, indent=4)
                except Exception as e:
                    return jsonify({"status": "error", "message": str(e)}), 500
            return jsonify({"status": "success", "memories": mem_data["memories"]})
            
    elif request.method == "DELETE":
        data = request.get_json(silent=True) or {}
        memory_to_delete = data.get("memory", "").strip()
        if memory_to_delete in mem_data["memories"]:
            mem_data["memories"].remove(memory_to_delete)
            try:
                with open(memory_file, "w") as f:
                    json.dump(mem_data, f, indent=4)
            except Exception as e:
                return jsonify({"status": "error", "message": str(e)}), 500
        return jsonify({"status": "success", "memories": mem_data["memories"]})
        
    return jsonify({"memories": mem_data.get("memories", [])})


# =========================================
# AUDIO + RECOGNIZER
# =========================================

pygame.mixer.pre_init(frequency=44100, size=-16, channels=2, buffer=256)
pygame.init()

recognizer = sr.Recognizer()
recognizer.energy_threshold = 250
recognizer.dynamic_energy_threshold = True
recognizer.pause_threshold = 0.5


# =========================================
# RUNTIME STATE
# =========================================

CURRENT_LANGUAGE = "english"
jarvis_active = False
is_speaking = False
stop_speaking = False
OPENED_APPS: list[str] = []


APP_PROCESSES = {
    "browser": ["msedge.exe"],
    "edge": ["msedge.exe"],
    "microsoft edge": ["msedge.exe"],
    "chrome": ["chrome.exe"],
    "google": ["chrome.exe"],
    "youtube": ["chrome.exe"],
    "whatsapp": ["WhatsApp.exe", "WhatsAppBeta.exe"],
    "spotify": ["Spotify.exe"],
    "camera": ["WindowsCamera.exe", "Camera.exe"],
    "vscode": ["Code.exe"],
    "vs code": ["Code.exe"],
    "notepad": ["notepad.exe"],
    "calculator": ["CalculatorApp.exe", "Calculator.exe"],
}


def run_async(coro):
    """Run async code safely from normal sync command handlers."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    return loop.run_until_complete(coro)


def speak_sync(text: str) -> None:
    run_async(speak(text))


def contains_any(text: str, phrases: tuple[str, ...] | list[str]) -> bool:
    return any(phrase in text for phrase in phrases)


def current_time_context() -> str:
    now = datetime.now().astimezone()
    return now.strftime("%A, %d %B %Y, %I:%M %p, %Z")


# =========================================
# SPEAK + LISTEN
# =========================================

async def speak(text: str) -> None:
    global is_speaking, stop_speaking

    if not text:
        return

    is_speaking = True
    stop_speaking = False
    send_status("speaking", text)
    print(f"\n{CONFIG.assistant_name}: {text}\n")

    voice = CONFIG.voice_map[CURRENT_LANGUAGE]
    chunks = textwrap.wrap(text, width=220)

    for index, chunk in enumerate(chunks):
        if stop_speaking:
            break

        filename = os.path.join(
            tempfile.gettempdir(),
            f"jarvis_voice_{uuid.uuid4().hex}_{index}.mp3"
        )

        try:
            communicate = edge_tts.Communicate(text=chunk, voice=voice, rate="+10%")
            await communicate.save(filename)

            pygame.mixer.music.load(filename)
            pygame.mixer.music.play()

            while pygame.mixer.music.get_busy():
                if stop_speaking:
                    pygame.mixer.music.stop()
                    break
                await asyncio.sleep(0.05)

            try:
                pygame.mixer.music.unload()
            except Exception:
                pass

        except Exception as e:
            print("Speak error:", e)
            send_status("error", f"Speak error: {e}")

        finally:
            try:
                if os.path.exists(filename):
                    os.remove(filename)
            except Exception:
                pass

    is_speaking = False
    send_status(
        "idle" if jarvis_active else "sleeping",
        "Waiting for your command" if jarvis_active else "Say a wake word to activate Jarvis"
    )


def listen(timeout: int = 5, phrase_time_limit: int = 10) -> str:
    if jarvis_active:
        send_status("listening", "Listening for your command...")
    else:
        send_status("listening", "Listening only for wake word")

    with sr.Microphone() as source:
        recognizer.adjust_for_ambient_noise(source, duration=0.5)
        recognizer.energy_threshold = 350
        recognizer.dynamic_energy_threshold = True
        recognizer.pause_threshold = 1.0
        recognizer.non_speaking_duration = 0.5

        print("Listening...")

        try:
            audio = recognizer.listen(
                source,
                timeout=timeout,
                phrase_time_limit=phrase_time_limit
            )
        except sr.WaitTimeoutError:
            send_status(
                "idle" if jarvis_active else "sleeping",
                "Waiting for your command" if jarvis_active else "Say a wake word to activate Jarvis"
            )
            return ""

    try:
        text = recognizer.recognize_google(
            audio,
            language=CONFIG.language_code[CURRENT_LANGUAGE]
        )
        print(f"\nYou: {text}\n")
        send_status("heard", f"You said: {text}")
        return text.lower().strip()

    except sr.UnknownValueError:
        send_status(
            "idle" if jarvis_active else "sleeping",
            "Could not understand. Try again." if jarvis_active else "Say a wake word to activate Jarvis"
        )
        return ""

    except Exception as e:
        print("Listen error:", e)
        send_status("error", f"Listen error: {e}")
        return ""


# =========================================
# SYSTEM CONTROLS
# =========================================


def open_uri_or_app(app_name: str, command: str) -> None:
    subprocess.Popen(command, shell=True)
    remember_opened_app(app_name)


def remember_opened_app(app_name: str) -> None:
    if app_name not in OPENED_APPS:
        OPENED_APPS.append(app_name)


def close_process_by_name(process_names: list[str]) -> bool:
    closed_any = False
    target_names = {name.lower() for name in process_names}

    for proc in psutil.process_iter(["pid", "name"]):
        try:
            process_name = str(proc.info.get("name") or "").lower()
            if process_name in target_names:
                proc.terminate()
                closed_any = True
        except Exception:
            pass

    return closed_any


def close_app(app_name: str) -> None:
    app_name = app_name.lower().strip()

    if app_name not in APP_PROCESSES:
        speak_sync("I do not know that app")
        return

    closed = close_process_by_name(APP_PROCESSES[app_name])

    if closed:
        speak_sync(f"Closed {app_name}")
        if app_name in OPENED_APPS:
            OPENED_APPS.remove(app_name)
    else:
        speak_sync(f"{app_name} is not open")


def close_all_opened_apps() -> None:
    if not OPENED_APPS:
        speak_sync("No apps opened by me are currently tracked")
        return

    for app_name in OPENED_APPS.copy():
        close_app(app_name)

    speak_sync("Closed all apps I opened")


BROWSER_TITLE_KEYWORDS = {
    "edge": ("microsoft edge",),
    "microsoft edge": ("microsoft edge",),
    "chrome": ("google chrome",),
    "browser": ("microsoft edge", "google chrome"),
}


BROWSER_PROCESS_NAMES = {
    "edge": ("msedge.exe",),
    "microsoft edge": ("msedge.exe",),
    "chrome": ("chrome.exe",),
    "browser": ("msedge.exe",),
}


def clean_command_query(text: str, prefixes: tuple[str, ...], suffixes: tuple[str, ...] = ()) -> str:
    query = text.strip()
    found_prefix = False

    for prefix in prefixes:
        if query.startswith(prefix):
            query = query[len(prefix):].strip()
            found_prefix = True
            break

    if not found_prefix:
        for prefix in prefixes:
            marker = f"{prefix} "
            marker_index = query.find(marker)
            if marker_index >= 0:
                query = query[marker_index + len(prefix):].strip()
                break

    for suffix in suffixes:
        if query.endswith(suffix):
            query = query[: -len(suffix)].strip()

    return query.strip(" .?!")


def is_browser_window_title(title: str, browser_name: str | None = None) -> bool:
    clean_title = (title or "").lower()
    if not clean_title:
        return False

    if browser_name:
        return any(keyword in clean_title for keyword in BROWSER_TITLE_KEYWORDS.get(browser_name, (browser_name,)))

    return any(
        keyword in clean_title
        for keywords in BROWSER_TITLE_KEYWORDS.values()
        for keyword in keywords
    )


def activate_window(window) -> bool:
    try:
        if getattr(window, "isMinimized", False):
            window.restore()
            time.sleep(0.25)

        window.activate()
        time.sleep(0.45)
        return True
    except Exception as e:
        print("Window activation error:", e)
        return False


def activate_window_by_title(keywords: tuple[str, ...] | list[str]) -> bool:
    wanted = tuple(keyword.lower() for keyword in keywords)

    try:
        windows = gw.getAllWindows()
    except Exception as e:
        print("Window lookup error:", e)
        return False

    for window in windows:
        title = (window.title or "").lower()
        if title and any(keyword in title for keyword in wanted):
            return activate_window(window)

    return False


def find_browser_window(browser_name: str | None = None):
    try:
        active = gw.getActiveWindow()
        if active and is_browser_window_title(active.title, browser_name):
            return active
    except Exception:
        pass

    try:
        for window in gw.getAllWindows():
            if is_browser_window_title(window.title, browser_name):
                return window
    except Exception as e:
        print("Browser window lookup error:", e)

    return None


def find_window_handle_by_process(process_names: tuple[str, ...] | list[str]) -> int | None:
    if os.name != "nt":
        return None

    target_names = {name.lower() for name in process_names}
    found_handle: list[int] = []
    user32 = ctypes.windll.user32

    enum_windows_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @enum_windows_proc
    def enum_window(hwnd, _lparam):
        if found_handle:
            return False

        if not user32.IsWindowVisible(hwnd):
            return True

        title_length = user32.GetWindowTextLengthW(hwnd)
        if title_length <= 0:
            return True

        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        try:
            process_name = psutil.Process(pid.value).name().lower()
        except Exception:
            return True

        if process_name in target_names:
            found_handle.append(int(hwnd))
            return False

        return True

    try:
        user32.EnumWindows(enum_window, 0)
    except Exception as e:
        print("Process window lookup error:", e)

    return found_handle[0] if found_handle else None


def activate_window_handle(hwnd: int | None) -> bool:
    if not hwnd or os.name != "nt":
        return False

    try:
        user32 = ctypes.windll.user32
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)

        user32.SetForegroundWindow(hwnd)
        time.sleep(0.55)
        return True
    except Exception as e:
        print("Window handle activation error:", e)
        return False


def activate_browser_window(browser_name: str = "edge") -> bool:
    window = find_browser_window(browser_name)
    if window and activate_window(window):
        return True

    process_names = BROWSER_PROCESS_NAMES.get(browser_name, (browser_name,))
    hwnd = find_window_handle_by_process(process_names)
    return activate_window_handle(hwnd)


def active_window_title() -> str:
    try:
        active = gw.getActiveWindow()
        return active.title if active else ""
    except Exception:
        return ""


def close_current_browser_tab(browser_name: str | None = None) -> bool:
    browser_name = browser_name or "edge"
    if not activate_browser_window(browser_name):
        speak_sync("I could not find an open Microsoft Edge window")
        return False

    pyautogui.hotkey("ctrl", "w")
    speak_sync("Closed the current Microsoft Edge tab")
    return True


def close_all_browser_tabs(browser_name: str | None = None) -> bool:
    browser_name = browser_name or "edge"
    if not activate_browser_window(browser_name):
        speak_sync("I could not find an open Microsoft Edge window")
        return False

    pyautogui.hotkey("ctrl", "shift", "w")
    speak_sync("Closed all tabs in the current Microsoft Edge window")
    return True


def close_browser_tab_by_title(site_name: str, title_keywords: tuple[str, ...], browser_name: str | None = None) -> bool:
    window = find_browser_window(browser_name)
    if not window or not activate_window(window):
        speak_sync("I could not find an open browser window")
        return False

    seen_titles: set[str] = set()
    wanted = tuple(keyword.lower() for keyword in title_keywords)

    for _ in range(30):
        title = active_window_title().lower()
        if title and any(keyword in title for keyword in wanted):
            pyautogui.hotkey("ctrl", "w")
            speak_sync(f"Closed the {site_name} tab")
            return True

        if title in seen_titles:
            break

        seen_titles.add(title)
        pyautogui.hotkey("ctrl", "tab")
        time.sleep(0.25)

    speak_sync(f"I could not find a {site_name} tab")
    return False


# =========================================
# CAMERA
# =========================================

def find_camera() -> int | None:
    for index in range(5):
        cam = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if cam.isOpened():
            ret, _ = cam.read()
            cam.release()
            if ret:
                return index
        else:
            cam.release()
    return None


def open_windows_camera() -> None:
    try:
        open_uri_or_app("camera", "start microsoft.windows.camera:")
        speak_sync("Opening camera")
    except Exception as e:
        print("Camera app error:", e)
        speak_sync("I could not open the camera app")


def take_photo() -> None:
    camera_index = find_camera()
    if camera_index is None:
        speak_sync("Camera not found")
        return

    cam = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    time.sleep(1)
    ret, frame = cam.read()

    if ret:
        filename = f"jarvis_photo_{int(time.time())}.png"
        cv2.imwrite(filename, frame)
        speak_sync("Photo captured")
        print("Saved:", filename)
    else:
        speak_sync("I could not capture the photo")

    cam.release()


def record_video(seconds: int = 10) -> None:
    camera_index = find_camera()
    if camera_index is None:
        speak_sync("Camera not found")
        return

    cam = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    time.sleep(1)

    width = int(cam.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
    height = int(cam.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
    filename = f"jarvis_video_{int(time.time())}.avi"

    writer = cv2.VideoWriter(
        filename,
        cv2.VideoWriter_fourcc(*"XVID"),
        20.0,
        (width, height)
    )

    speak_sync("Recording started")
    start = time.time()

    while time.time() - start < seconds:
        ret, frame = cam.read()
        if not ret:
            break

        writer.write(frame)
        cv2.imshow("Jarvis Recording", frame)

        if cv2.waitKey(1) == ord("q"):
            break

    cam.release()
    writer.release()
    cv2.destroyAllWindows()
    speak_sync("Video saved")
    print("Saved:", filename)


# =========================================
# WHATSAPP
# =========================================

def send_whatsapp_app_message(contact_name: str, message: str) -> None:
    try:
        whatsapp_window = open_whatsapp_window()

        if not whatsapp_window:
            speak_sync("I could not open WhatsApp. Please open WhatsApp once, then try again.")
            return

        send_status("executing", f"Searching WhatsApp contact: {contact_name}")
        pyautogui.hotkey("ctrl", "f")
        time.sleep(1.0)
        pyautogui.write(contact_name, interval=0.01)
        time.sleep(1.5)
        pyautogui.press("enter")
        time.sleep(2.0)

        send_status("executing", "Typing WhatsApp message")
        pyautogui.write(message, interval=0.01)
        time.sleep(0.5)
        pyautogui.press("enter")
        speak_sync("WhatsApp message sent")

    except Exception as e:
        print("WhatsApp error:", e)
        speak_sync("Failed to send WhatsApp message")


def find_whatsapp_window():
    try:
        windows = gw.getAllWindows()
    except Exception as e:
        print("WhatsApp window lookup error:", e)
        return None

    for window in windows:
        title = (window.title or "").lower()
        if "whatsapp" in title:
            return window

    return None


def wait_for_whatsapp_window(timeout: float = 10.0):
    deadline = time.time() + timeout

    while time.time() < deadline:
        window = find_whatsapp_window()
        if window:
            return window
        time.sleep(0.5)

    return None


def open_whatsapp_window():
    send_status("executing", "Opening WhatsApp...")

    window = find_whatsapp_window()
    if window and activate_window(window):
        return window

    launch_attempts = [
        lambda: os.startfile("whatsapp:"),
        lambda: subprocess.Popen("start whatsapp:", shell=True),
        lambda: subprocess.Popen(
            r'explorer.exe shell:AppsFolder\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App',
            shell=True,
        ),
    ]

    for launch in launch_attempts:
        try:
            launch()
            window = wait_for_whatsapp_window(timeout=8)
            if window and activate_window(window):
                return window
        except Exception as e:
            print("WhatsApp launch attempt failed:", e)

    try:
        pyautogui.press("win")
        time.sleep(0.5)
        pyautogui.write("WhatsApp", interval=0.02)
        time.sleep(0.4)
        pyautogui.press("enter")
        window = wait_for_whatsapp_window(timeout=10)
        if window and activate_window(window):
            return window
    except Exception as e:
        print("WhatsApp Start menu launch failed:", e)

    return None


def open_whatsapp_command() -> None:
    if open_whatsapp_window():
        speak_sync("Opening WhatsApp")
    else:
        speak_sync("I could not open WhatsApp")


# =========================================
# COMMAND ROUTER
# =========================================

def ask_for(prompt: str) -> str:
    speak_sync(prompt)
    return listen(timeout=7, phrase_time_limit=12)


def handle_whatsapp_message() -> bool:
    contact = ask_for("Who should I send it to?")
    if not contact:
        speak_sync("Contact not detected")
        return True

    message = ask_for("What should I send?")
    if not message:
        speak_sync("Message cancelled")
        return True

    speak_sync("Sending message")
    send_whatsapp_app_message(contact, message)
    return True


def execute_command(text: str) -> bool:
    global CURRENT_LANGUAGE

    command_handlers: list[tuple[Callable[[str], bool], Callable[[], None]]] = [
        (lambda t: "time" in t, speak_current_time),
        (lambda t: "date" in t or "today's date" in t, speak_current_date),
        (lambda t: "day" in t or "what is today" in t, speak_current_day),
        (lambda t: "speak english" in t, lambda: set_language("english")),
        (lambda t: "open google" in t, lambda: open_edge_website("Google", "https://google.com")),
        (lambda t: "open youtube" in t, lambda: open_edge_website("YouTube", "https://youtube.com")),
        (lambda t: "search google" in t or "google search" in t or t.startswith("search for ") or t.startswith("search in google"), lambda: search_google(text)),
        (lambda t: "open spotify" in t, lambda: open_desktop_app("spotify", "start spotify", "Opening Spotify")),
        (lambda t: ("spotify" in t and "play" in t) or t.startswith("play spotify "), lambda: play_spotify(text)),
        (lambda t: "open whatsapp" in t, open_whatsapp_command),
        (lambda t: "open notepad" in t, lambda: open_desktop_app("notepad", "notepad", "Opening Notepad")),
        (lambda t: "open calculator" in t, lambda: open_desktop_app("calculator", "calc", "Opening Calculator")),
        (lambda t: "send message in whatsapp" in t or "send a message in whatsapp" in t or "send message on whatsapp" in t or "send a message on whatsapp" in t or "send whatsapp message" in t or "send a whatsapp message" in t, handle_whatsapp_message),
        (lambda t: t.startswith("play "), lambda: play_youtube(text)),
        (lambda t: "open camera" in t, open_windows_camera),
        (lambda t: "take photo" in t or "click photo" in t, take_photo),
        (lambda t: "record video" in t or "take video" in t, lambda: record_video(10)),
        (lambda t: "shutdown laptop" in t or "shutdown computer" in t or "turn off laptop" in t, shutdown_laptop),
        (lambda t: "restart laptop" in t or "restart computer" in t, restart_laptop),
        (lambda t: "lock laptop" in t or "lock computer" in t, lock_laptop),
        (lambda t: "close current tab" in t or "close this tab" in t or "close single tab" in t or t == "close tab", lambda: close_current_browser_tab("edge")),
        (lambda t: "close all tabs" in t or "close all tab" in t or "close all browser tabs" in t, lambda: close_all_browser_tabs("edge")),
        (lambda t: "close google" in t, lambda: close_app("edge")),
        (lambda t: "close youtube" in t, lambda: close_app("edge")),
        (lambda t: "close microsoft edge" in t or "close edge" in t, lambda: close_app("edge")),
        (lambda t: "close chrome" in t or "close google chrome" in t, lambda: close_app("chrome")),
        (lambda t: "close browser" in t, lambda: close_app("edge")),
        (lambda t: "close whatsapp" in t, lambda: close_app("whatsapp")),
        (lambda t: "close spotify" in t, lambda: close_app("spotify")),
        (lambda t: "close camera" in t, lambda: close_app("camera")),
        (lambda t: "close vscode" in t or "close vs code" in t, lambda: close_app("vscode")),
        (lambda t: "close all apps" in t or "close everything" in t, close_all_opened_apps),
    ]

    for matcher, handler in command_handlers:
        if matcher(text):
            handler()
            return True

    return False


def speak_current_time() -> None:
    now = datetime.now()
    speak_sync(f"It is {now.strftime('%I:%M %p')}.")


def speak_current_date() -> None:
    now = datetime.now()
    speak_sync(now.strftime("Today is %d %B %Y."))


def speak_current_day() -> None:
    now = datetime.now()
    speak_sync(now.strftime("Today is %A, %d %B."))


def set_language(language: str) -> None:
    global CURRENT_LANGUAGE
    CURRENT_LANGUAGE = language
    speak_sync(f"Now speaking in {language}")


def open_website(name: str, url: str) -> None:
    webbrowser.open(url)
    remember_opened_app("browser")
    speak_sync(f"Opening {name}")


def open_edge_website(name: str, url: str, announce: bool = True) -> None:
    try:
        subprocess.Popen(f'start msedge "{url}"', shell=True)
    except Exception as e:
        print("Microsoft Edge open error:", e)
        webbrowser.open(url)

    remember_opened_app("edge")
    if announce:
        speak_sync(f"Opening {name}")


def open_desktop_app(app_name: str, command: str, message: str) -> None:
    os.system(command)
    remember_opened_app(app_name)
    speak_sync(message)


def play_youtube(text: str) -> None:
    song = text.replace("play", "", 1).strip()

    if not song:
        speak_sync("Tell me what to play")
        return

    try:
        import pywhatkit
        pywhatkit.playonyt(song)
    except Exception as e:
        print("YouTube play error:", e)
        webbrowser.open(f"https://www.youtube.com/results?search_query={quote_plus(song)}")

    remember_opened_app("browser")
    speak_sync(f"Playing {song}")


def search_google(text: str) -> None:
    query = clean_command_query(
        text,
        (
            "search google for",
            "search in google for",
            "search in google",
            "google search for",
            "google search",
            "search for",
        ),
    )

    if not query or query == "google":
        query = ask_for("What should I search on Google?")

    if not query:
        speak_sync("Search cancelled")
        return

    url = f"https://www.google.com/search?q={quote_plus(query)}"
    open_edge_website("Google search", url, announce=False)
    speak_sync(f"Searching Google for {query}")


def extract_spotify_song(text: str) -> str:
    song = clean_command_query(
        text,
        (
            "play spotify",
            "spotify play",
            "play song",
            "play music",
            "play",
        ),
        ("on spotify", "in spotify", "spotify"),
    )

    return song.strip()


def get_spotify_track_id(song_name: str) -> str:
    import urllib.request
    import re
    from urllib.parse import quote
    try:
        query = f"site:open.spotify.com/track {song_name}"
        url = f"https://html.duckduckgo.com/html/?q={quote(query)}"
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            html = response.read().decode('utf-8', errors='ignore')
        
        match = re.search(r'open\.spotify\.com/track/([a-zA-Z0-9]+)', html)
        if match:
            track_id = match.group(1)
            print(f"Found Spotify track ID for '{song_name}': {track_id}")
            return track_id
    except Exception as e:
        print("Error searching Spotify track ID:", e)
    return ""


def play_spotify(text: str) -> None:
    song = extract_spotify_song(text)

    if not song:
        song = ask_for("What should I play on Spotify?")

    if not song:
        speak_sync("Spotify play cancelled")
        return

    send_status("executing", f"Searching Spotify track for {song}")
    track_id = get_spotify_track_id(song)

    if track_id:
        send_status("executing", f"Playing {song} on Spotify")
        try:
            os.startfile(f"spotify:track:{track_id}")
            remember_opened_app("spotify")
            speak_sync(f"Playing {song} on Spotify")
        except Exception as e:
            print("Spotify desktop app play error:", e)
            webbrowser.open(f"https://open.spotify.com/track/{track_id}")
            remember_opened_app("browser")
            speak_sync(f"Playing {song} on Spotify web player")
    else:
        # Fallback to search query
        send_status("executing", f"Opening Spotify search for {song}")
        try:
            os.startfile(f"spotify:search:{quote(song)}")
            remember_opened_app("spotify")
            time.sleep(3.5)

            if activate_window_by_title(("spotify",)):
                pyautogui.press("enter")

            speak_sync(f"Opening Spotify search for {song}")
        except Exception as e:
            print("Spotify app search error:", e)
            webbrowser.open(f"https://open.spotify.com/search/{quote(song)}")
            remember_opened_app("browser")
            speak_sync(f"Opening Spotify search for {song}")



def confirm_laptop_action(action_name: str) -> bool:
    speak_sync(f"Confirm {action_name}. Say confirm to continue.")
    confirmation = listen(timeout=6, phrase_time_limit=4)

    if "confirm" in confirmation:
        return True

    speak_sync(f"{action_name.capitalize()} cancelled")
    return False


def shutdown_laptop() -> None:
    if not confirm_laptop_action("shutdown"):
        return

    speak_sync("Shutting down laptop")
    os.system("shutdown /s /t 5")


def restart_laptop() -> None:
    if not confirm_laptop_action("restart"):
        return

    speak_sync("Restarting laptop")
    os.system("shutdown /r /t 5")


def lock_laptop() -> None:
    speak_sync("Locking laptop")
    os.system("rundll32.exe user32.dll,LockWorkStation")


# =========================================
# AI RESPONSE
# =========================================

def get_gemini_response(text: str, api_key: str, model_name: str = "gemini-1.5-flash") -> str:
    if not api_key:
        return "Gemini API key is missing. Set it in Settings."
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    
    # Load memories
    memories_bullet = ""
    try:
        if os.path.exists("backend/memory.json"):
            with open("backend/memory.json", "r") as f:
                mem_data = json.load(f)
                m_list = mem_data.get("memories", [])
                if m_list:
                    memories_bullet = "\nThings you MUST remember about the creator/user:\n" + "\n".join(f"- {m}" for m in m_list)
    except Exception:
        pass
        
    system_instruction = f"""
You are {CONFIG.assistant_name}, a concise AI assistant created by {CONFIG.creator_name}.
Current real local time: {current_time_context()}.
{memories_bullet}

Rules:
- Keep normal answers under {CONFIG.max_reply_words} words.
- Use one or two short sentences.
- For time, date, or today questions, use the current real local time above.
- If asked for latest news, live weather, scores, prices, or current internet facts, say you need a connected web/API source unless the user asks you to open a search.
- Give longer answers only when the user asks for full detail, explain, or step-by-step.
"""
    
    # Build contents from CHAT_HISTORY
    contents = []
    for msg in CHAT_HISTORY[:-1]:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({
            "role": role,
            "parts": [{"text": msg["content"]}]
        })
        
    # Append current message
    contents.append({
        "role": "user",
        "parts": [{"text": text}]
    })
    
    payload = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 180
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=20)
        if response.status_code == 200:
            res_data = response.json()
            reply = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
            return shorten_reply(reply)
        else:
            print("Gemini API error:", response.status_code, response.text)
            return f"Gemini returned error {response.status_code}."
    except Exception as e:
        print("Gemini connection error:", e)
        return "Gemini API connection failed."


def get_ai_response(text: str) -> str:
    global CHAT_HISTORY
    
    # Add user message to history
    CHAT_HISTORY.append({"role": "user", "content": text})
    if len(CHAT_HISTORY) > 15:
        CHAT_HISTORY = CHAT_HISTORY[-15:]
        
    provider = getattr(CONFIG, "api_provider", "deepseek")
    
    if provider == "gemini":
        api_key = getattr(CONFIG, "gemini_api_key", "")
        if not api_key:
            api_key = os.getenv("GEMINI_API_KEY", "")
        model = getattr(CONFIG, "active_model", "") or "gemini-1.5-flash"
        reply = get_gemini_response(text, api_key, model)
        CHAT_HISTORY.append({"role": "assistant", "content": reply})
        return reply

    # Otherwise DeepSeek or OpenRouter
    api_key = ""
    if provider == "deepseek":
        api_key = getattr(CONFIG, "deepseek_api_key", "")
        if not api_key:
            api_key = os.getenv("DEEPSEEK_API_KEY", "")
    elif provider == "openrouter":
        api_key = getattr(CONFIG, "deepseek_api_key", "") # fallback to deepseek key in settings
        if not api_key:
            api_key = os.getenv("OPENROUTER_API_KEY", "") or os.getenv("DEEPSEEK_API_KEY", "")

    if not api_key:
        return "API key is missing. Set it in the Settings tab."

    api_key = api_key.strip().strip('"').strip("'")
    is_openrouter_key = api_key.startswith("sk-or-") or provider == "openrouter"
    api_url = CONFIG.openrouter_api_url if is_openrouter_key else CONFIG.deepseek_api_url
    
    default_model = CONFIG.openrouter_model if is_openrouter_key else CONFIG.deepseek_model
    model = getattr(CONFIG, "active_model", "") or default_model
    provider_name = "OpenRouter" if is_openrouter_key else "DeepSeek"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    if is_openrouter_key:
        headers["HTTP-Referer"] = "http://localhost:5000"
        headers["X-Title"] = "Secure Jarvis AI Agent"

    memories_bullet = ""
    try:
        if os.path.exists("backend/memory.json"):
            with open("backend/memory.json", "r") as f:
                mem_data = json.load(f)
                m_list = mem_data.get("memories", [])
                if m_list:
                    memories_bullet = "\nThings to remember about the creator/user:\n" + "\n".join(f"- {m}" for m in m_list)
    except Exception:
        pass

    system_content = f"""
You are {CONFIG.assistant_name}, a concise AI assistant created by {CONFIG.creator_name}.
Current real local time: {current_time_context()}.
{memories_bullet}

Rules:
- Keep normal answers under {CONFIG.max_reply_words} words.
- Use one or two short sentences.
- For time, date, or today questions, use the current real local time above.
- If asked for latest news, live weather, scores, prices, or current internet facts, say you need a connected web/API source unless the user asks you to open a search.
- Give longer answers only when the user asks for full detail, explain, or step-by-step.
"""

    messages = [{"role": "system", "content": system_content}]
    
    # Filter CHAT_HISTORY to only contain elements before the current user message that we appended
    # But since CHAT_HISTORY is standard user-assistant structure, we can just use messages from it.
    messages.extend(CHAT_HISTORY)

    try:
        response = requests.post(
            api_url,
            headers=headers,
            json={
                "model": model,
                "temperature": 0.3,
                "max_tokens": 180,
                "messages": messages,
            },
            timeout=30
        )

        if response.status_code == 401:
            return f"{provider_name} rejected the API key. Create a new key and set it again."

        if response.status_code == 402:
            return f"{provider_name} says your account has no balance or payment is required."

        if response.status_code == 429:
            return f"{provider_name} rate limit reached. Try again in a moment."

        if response.status_code >= 400:
            print(f"{provider_name} HTTP error:", response.status_code, response.text[:500])
            return f"{provider_name} returned error {response.status_code}. Check the terminal."

        data = response.json()
        reply = data["choices"][0]["message"]["content"].strip()
        reply = shorten_reply(reply)
        CHAT_HISTORY.append({"role": "assistant", "content": reply})
        return reply

    except requests.exceptions.Timeout:
        return "DeepSeek took too long to respond. Check your internet and try again."

    except requests.exceptions.ConnectionError as e:
        print(f"{provider_name} connection error:", e)
        return f"I cannot reach {provider_name}. Check your internet, VPN, or firewall."

    except Exception as e:
        print(f"{provider_name} error:", e)
        return f"{provider_name} failed. Check the terminal error."


def shorten_reply(reply: str) -> str:
    if not reply:
        return "I could not generate a response."

    words = reply.split()
    if len(words) <= CONFIG.max_reply_words:
        return reply

    return " ".join(words[:CONFIG.max_reply_words]).rstrip(".,;:") + "."


# =========================================
# MAIN LOOP
# =========================================

def start_jarvis() -> None:
    global jarvis_active, stop_speaking

    print("Jarvis online. Waiting for wake word.")
    send_status("sleeping", "Say a wake word to activate Jarvis")

    while True:
        try:
            text = listen()
            if not text:
                continue

            if contains_any(text, CONFIG.wake_words):
                jarvis_active = True
                send_status("active", "Jarvis activated")
                speak_sync(f"Yes Master {CONFIG.creator_name}?")
                continue

            if contains_any(text, CONFIG.exit_commands):
                speak_sync("Goodbye Master")
                break

            if not jarvis_active:
                send_status("sleeping", "Say a wake word to activate Jarvis")
                continue

            if contains_any(text, CONFIG.sleep_commands):
                speak_sync("Entering sleep mode")
                jarvis_active = False
                send_status("sleeping", "Say a wake word to activate Jarvis")
                continue

            if contains_any(text, CONFIG.stop_commands):
                stop_speaking = True
                send_status("idle", "Stopped speaking")
                continue

            send_status("executing", "Checking command...")
            if execute_command(text):
                continue

            send_status("processing", "Thinking...")
            reply = get_ai_response(text)
            speak_sync(reply)

        except KeyboardInterrupt:
            print("Jarvis stopped manually.")
            break

        except Exception as e:
            print("Error:", e)
            send_status("error", str(e))


def emit_system_stats() -> None:
    print("[TELEMETRY] System telemetry thread active.")
    while True:
        try:
            cpu = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory().percent
            processes = len(list(psutil.process_iter()))
            socketio.emit("system_telemetry", {
                "cpu": cpu,
                "ram": ram,
                "processes": processes
            })
        except Exception as e:
            print("Telemetry emit error:", e)
        time.sleep(2)


if __name__ == "__main__":
    load_config_file()
    
    jarvis_thread = threading.Thread(target=start_jarvis, daemon=True)
    jarvis_thread.start()

    telemetry_thread = threading.Thread(target=emit_system_stats, daemon=True)
    telemetry_thread.start()

    socketio.run(
        app,
        host=CONFIG.host,
        port=CONFIG.port,
        debug=False,
        use_reloader=False,
        allow_unsafe_werkzeug=True
    )
