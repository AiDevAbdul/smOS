#!/usr/bin/env python3
"""Upload a file to Google Drive and return a shareable link.

Usage:
    python3 scripts/lib/drive_upload.py <file_path> [--folder-id FOLDER_ID] [--name NAME]

Returns JSON: {"file_id": "...", "drive_link": "https://drive.google.com/file/d/.../view"}
"""

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path


def _load_env() -> dict:
    env_path = Path.home() / ".config" / "smos" / ".env"
    env = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    env.update(os.environ)
    return env


def upload_file(
    file_path: str | Path,
    folder_id: str | None = None,
    file_name: str | None = None,
) -> dict:
    """Upload file_path to Drive. Returns {"file_id", "drive_link"}."""
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    sys.path.insert(0, str(Path(__file__).parent))
    from google_auth import get_credentials

    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    if folder_id is None:
        env = _load_env()
        folder_id = env.get("GOOGLE_DRIVE_FOLDER_ID")

    mime_type, _ = mimetypes.guess_type(str(file_path))
    mime_type = mime_type or "application/octet-stream"

    creds = get_credentials()
    service = build("drive", "v3", credentials=creds)

    metadata = {"name": file_name or file_path.name}
    if folder_id:
        metadata["parents"] = [folder_id]

    media = MediaFileUpload(str(file_path), mimetype=mime_type, resumable=True)
    uploaded = (
        service.files()
        .create(body=metadata, media_body=media, fields="id,webViewLink")
        .execute()
    )

    # Make it readable by anyone with the link
    service.permissions().create(
        fileId=uploaded["id"],
        body={"type": "anyone", "role": "reader"},
    ).execute()

    return {
        "file_id": uploaded["id"],
        "drive_link": uploaded.get("webViewLink", f"https://drive.google.com/file/d/{uploaded['id']}/view"),
    }


def main():
    p = argparse.ArgumentParser(description="Upload a file to Google Drive")
    p.add_argument("file", help="Path to file to upload")
    p.add_argument("--folder-id", help="Drive folder ID (defaults to GOOGLE_DRIVE_FOLDER_ID env)")
    p.add_argument("--name", help="Override filename in Drive")
    args = p.parse_args()

    result = upload_file(args.file, folder_id=args.folder_id, file_name=args.name)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
