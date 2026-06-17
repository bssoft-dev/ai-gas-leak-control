"""
M_Mailer: SMTP를 통해 실제 메일 전송
E_UserApproved → 메일 발송 → 초안 파일 이동/이름 변경
"""
import os
import re
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path
from typing import List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 환경변수
SMTP_HOST = os.getenv("SMTP_HOST", "localhost")
SMTP_PORT = int(os.getenv("SMTP_PORT", "25"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "noreply@local")
SENT_FOLDER = os.getenv("SENT_FOLDER", "")  # 비어 있으면 같은 폴더에서 이름만 변경


class MailerModule(Module):
    """E_UserApproved → SMTP 발송 + 파일 정리"""

    name = "M_Mailer"
    description = "SMTP를 통한 이메일 발송 모듈"
    capabilities = ["E_UserApproved"]

    def __init__(self, host: str = "", port: int = 0, user: str = "", password: str = "", from_addr: str = "", sent_folder: str = ""):
        self.host = host or SMTP_HOST
        self.port = port or SMTP_PORT
        self.user = user or SMTP_USER
        self.password = password or SMTP_PASSWORD
        self.from_addr = from_addr or SMTP_FROM
        self.sent_folder = sent_folder or SENT_FOLDER

    def can_handle(self, event: Event) -> float:
        return 1.0 if event.type == "E_UserApproved" else 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_UserApproved":
            return []
        path = event.payload.get("path", "")
        content = event.payload.get("content", "")
        to_addr = event.payload.get("to", "")
        subject = event.payload.get("subject", "")
        body, to_addr, subject = self._extract_body_and_meta(content, to_addr, subject)
        if not to_addr:
            to_addr = "team@company.com"
        ok = self._send_mail(to_addr, subject, body)
        if ok and path and os.path.exists(path):
            self._move_or_rename_sent(path)
        return []

    def _extract_body_and_meta(self, content: str, to_addr: str, subject: str):
        """협상 헤더 아래 본문만 추출"""
        lines = content.split("\n")
        in_body = False
        body_lines = []
        for line in lines:
            if line.strip() == "---":
                in_body = True
                continue
            if in_body:
                if re.search(r"\[x\]\s*발송승인", line, re.IGNORECASE):
                    continue
                if line.strip().lower().startswith("to:") or line.strip().startswith("받는이:"):
                    if not to_addr:
                        to_addr = line.split(":", 1)[1].strip()
                    continue
                if line.strip().lower().startswith("subject:") or line.strip().startswith("제목:"):
                    if not subject:
                        subject = line.split(":", 1)[1].strip()
                    continue
                body_lines.append(line)
            else:
                if line.strip().lower().startswith("to:"):
                    to_addr = line.split(":", 1)[1].strip()
                if "제목:" in line or line.strip().lower().startswith("subject:"):
                    subject = line.split(":", 1)[1].strip()
        body = "\n".join(body_lines).strip()
        return body, to_addr, subject

    def _send_mail(self, to: str, subject: str, body: str) -> bool:
        try:
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = subject
            msg["From"] = self.from_addr
            msg["To"] = to
            with smtplib.SMTP(self.host, self.port) as s:
                if self.user and self.password:
                    s.starttls()
                    s.login(self.user, self.password)
                s.sendmail(self.from_addr, [to], msg.as_string())
            return True
        except Exception as e:
            return False

    def _move_or_rename_sent(self, path: str):
        p = Path(path)
        if self.sent_folder:
            dest_dir = Path(self.sent_folder)
            dest_dir.mkdir(parents=True, exist_ok=True)
            new_name = f"[발송완료]_{p.name}"
            dest = dest_dir / new_name
        else:
            new_name = f"[발송완료]_{p.name}"
            dest = p.parent / new_name
        try:
            if dest.exists():
                os.remove(dest)
            os.rename(path, str(dest))
        except Exception:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    c = f.read()
                with open(dest, "w", encoding="utf-8") as f:
                    f.write(c)
                os.remove(path)
            except Exception:
                pass
