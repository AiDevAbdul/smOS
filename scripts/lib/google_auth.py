#!/usr/bin/env python3
"""One-time Google OAuth2 flow for smOS.

Reads GDRIVE_CREDENTIALS (or GMAIL_CREDENTIALS) from the smOS env file,
runs the browser-based consent flow once, and persists the refresh token to
~/.config/smos/google_token.json. Subsequent calls load the token and
refresh it silently — no browser needed.

Usage (run once from terminal):
    python3 scripts/lib/google_auth.py

Then import get_credentials() in other scripts.
"""

import json
import os
import sys
from pathlib import Path

TOKEN_PATH = Path.home() / ".config" / "smos" / "google_token.json"
ENV_PATH = Path.home() / ".config" / "smos" / ".env"

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/gmail.send",
]


def _load_env() -> dict:
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    env.update(os.environ)
    return env


def _parse_creds_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def get_credentials():
    """Return valid google.oauth2.credentials.Credentials, refreshing if needed."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save_token(creds)
        return creds

    # No valid token — run the browser flow
    return _run_auth_flow()


def _run_auth_flow():
    from google_auth_oauthlib.flow import InstalledAppFlow

    env = _load_env()
    raw = env.get("GDRIVE_CREDENTIALS") or env.get("GMAIL_CREDENTIALS", "")
    cred_data = _parse_creds_json(raw)

    if not cred_data.get("client_id") or not cred_data.get("client_secret"):
        print(
            "ERROR: GDRIVE_CREDENTIALS not set or missing client_id/client_secret in ~/.config/smos/.env",
            file=sys.stderr,
        )
        sys.exit(1)

    client_config = {
        "installed": {
            "client_id": cred_data["client_id"],
            "client_secret": cred_data["client_secret"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")
    _save_token(creds)
    print(f"Token saved to {TOKEN_PATH}")
    return creds


def _save_token(creds):
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(creds.to_json())


if __name__ == "__main__":
    get_credentials()
    print("Authentication complete. Token stored at:", TOKEN_PATH)
