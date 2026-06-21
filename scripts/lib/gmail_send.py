#!/usr/bin/env python3
"""Send an email via Gmail API with an optional attachment.

Usage:
    python3 scripts/lib/gmail_send.py \
        --to client@example.com \
        --subject "Weekly Report" \
        --body "See attached report." \
        --attachment path/to/report.pdf

Returns JSON: {"message_id": "..."}
"""

import argparse
import base64
import json
import mimetypes
import os
import sys
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
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


def send_email(
    to: str,
    subject: str,
    body: str,
    attachment_path: str | Path | None = None,
    from_address: str | None = None,
    body_html: str | None = None,
) -> dict:
    """Send an email. Returns {"message_id": "..."}."""
    from googleapiclient.discovery import build

    sys.path.insert(0, str(Path(__file__).parent))
    from google_auth import get_credentials

    env = _load_env()
    sender = from_address or env.get("GMAIL_FROM_ADDRESS", "me")

    # Build message
    if body_html:
        msg = MIMEMultipart("mixed")
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(body, "plain"))
        alt.attach(MIMEText(body_html, "html"))
        msg.attach(alt)
    elif attachment_path:
        msg = MIMEMultipart()
        msg.attach(MIMEText(body, "plain"))
    else:
        msg = MIMEText(body, "plain")

    msg["To"] = to
    msg["From"] = sender
    msg["Subject"] = subject

    if attachment_path:
        attachment_path = Path(attachment_path)
        if attachment_path.exists():
            mime_type, _ = mimetypes.guess_type(str(attachment_path))
            maintype, subtype = (mime_type or "application/octet-stream").split("/", 1)
            with open(attachment_path, "rb") as f:
                part = MIMEApplication(f.read(), _subtype=subtype)
            part.add_header(
                "Content-Disposition", "attachment", filename=attachment_path.name
            )
            msg.attach(part)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    creds = get_credentials()
    service = build("gmail", "v1", credentials=creds)
    sent = service.users().messages().send(userId="me", body={"raw": raw}).execute()

    return {"message_id": sent.get("id", "")}


def main():
    p = argparse.ArgumentParser(description="Send an email via Gmail API")
    p.add_argument("--to", required=True, help="Recipient email address")
    p.add_argument("--subject", required=True, help="Email subject")
    p.add_argument("--body", required=True, help="Plain text body")
    p.add_argument("--attachment", help="Path to file to attach")
    p.add_argument("--from", dest="from_addr", help="Sender address (default: GMAIL_FROM_ADDRESS)")
    args = p.parse_args()

    result = send_email(
        to=args.to,
        subject=args.subject,
        body=args.body,
        attachment_path=args.attachment,
        from_address=args.from_addr,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
