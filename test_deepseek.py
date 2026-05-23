import os
import requests


api_key = os.getenv("DEEPSEEK_API_KEY")

if not api_key:
    raise SystemExit("Missing DEEPSEEK_API_KEY. Set it in this terminal first.")

api_key = api_key.strip().strip('"').strip("'")
is_openrouter_key = api_key.startswith("sk-or-")
api_url = (
    "https://openrouter.ai/api/v1/chat/completions"
    if is_openrouter_key
    else "https://api.deepseek.com/chat/completions"
)
model = "deepseek/deepseek-chat" if is_openrouter_key else "deepseek-chat"
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
}

if is_openrouter_key:
    headers["HTTP-Referer"] = "http://localhost:5000"
    headers["X-Title"] = "Secure Jarvis AI Agent"

print("Provider:", "OpenRouter" if is_openrouter_key else "DeepSeek")
print("Model:", model)

response = requests.post(
    api_url,
    headers=headers,
    json={
        "model": model,
        "messages": [
            {"role": "system", "content": "Reply with one short sentence."},
            {"role": "user", "content": "Say connected."},
        ],
        "temperature": 0.2,
        "max_tokens": 30,
    },
    timeout=30,
)

print("Status:", response.status_code)
print(response.text[:1000])