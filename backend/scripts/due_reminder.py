import os
import sys
import ssl
import smtplib
from datetime import date, timedelta
from email.message import EmailMessage
from dotenv import load_dotenv
from sqlalchemy import text
import json

# Allow running as module: `python -m scripts.due_reminder` from backend folder
# Ensure app package is importable when executed directly
CURRENT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Load env early so app.database can pick up DATABASE_URL when imported
try:
    env_path_early = os.path.join(BACKEND_DIR, ".env")
    load_dotenv(dotenv_path=env_path_early, override=False)
except Exception:
    pass

from app.database import SessionLocal  # noqa: E402


def get_env():
    # Load .env if present (explicit path to backend folder for scheduler contexts)
    try:
        env_path = os.path.join(BACKEND_DIR, ".env")
        load_dotenv(dotenv_path=env_path, override=False)
    except Exception:
        pass
    smtp_host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("EMAIL_PORT", "587"))
    smtp_user = os.getenv("EMAIL_USER")
    smtp_pass = os.getenv("EMAIL_PASS")
    email_from = os.getenv("EMAIL_FROM", smtp_user or "")
    if not smtp_user or not smtp_pass or not email_from:
        raise RuntimeError("Email credentials are not configured (EMAIL_USER/EMAIL_PASS/EMAIL_FROM)")
    return smtp_host, smtp_port, smtp_user, smtp_pass, email_from


def fmt_date(d):
    try:
        return d.strftime("%Y-%m-%d") if d is not None else "—"
    except Exception:
        return str(d)


def send_email(smtp_host, smtp_port, smtp_user, smtp_pass, sender, to_addr, subject, body):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_addr
    msg.set_content(body)

    context = ssl.create_default_context()
    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
        server.ehlo()
        server.starttls(context=context)
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)


def _ensure_email_logs_table(db):
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS public.email_logs (
              id SERIAL PRIMARY KEY,
              sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              to_email TEXT,
              subject TEXT,
              body TEXT,
              status TEXT,
              error TEXT,
              context JSONB
            )
            """
        ))
    except Exception:
        pass


def _log_email(db, to_email: str, subject: str, body: str, status: str, error: str | None, context_dict: dict | None = None):
    try:
        _ensure_email_logs_table(db)
        db.execute(text(
            """
            INSERT INTO public.email_logs (to_email, subject, body, status, error, context)
            VALUES (:to_email, :subject, :body, :status, :error, CAST(:context AS JSONB))
            """
        ), {
            "to_email": to_email,
            "subject": subject,
            "body": body,
            "status": status,
            "error": (error or None),
            "context": json.dumps(context_dict) if context_dict is not None else None,
        })
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def main():
    # Days before due: if 0 -> today; if N -> notify N days before due date
    try:
        offset_days = int(os.getenv("DAYS_BEFORE_DUE", "0"))
        if offset_days < 0:
            offset_days = 0
    except Exception:
        offset_days = 0
    target_due = date.today() + timedelta(days=offset_days)
    smtp_host, smtp_port, smtp_user, smtp_pass, email_from = get_env()

    db = SessionLocal()
    try:
        # Ensure required columns exist on gauge_requests
        try:
            db.execute(text("ALTER TABLE public.gauge_requests ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ"))
        except Exception:
            pass

        # 1) Fetch gauges due in 3 days
        rows = db.execute(text(
            """
            SELECT gauge_id, name_of_the_equipment, calibration_due
            FROM public.equipment_used_for_calibration
            WHERE calibration_due = :due
            ORDER BY gauge_id
            """
        ), {"due": target_due}).mappings().all()

        if not rows:
            return 0

        unassigned = []  # list of dicts: {gauge_id, due_date}

        for row in rows:
            gid = row["gauge_id"]
            gauge_name = row.get("name_of_the_equipment") or f"Gauge {gid}"
            due_val = row.get("calibration_due")

            # 2) Check if assigned: accepted and not returned
            holder = db.execute(text(
                """
                SELECT requested_by, accepted_by
                FROM public.gauge_requests
                WHERE gauge_id = :gid AND status = 'accepted' AND returned_at IS NULL
                ORDER BY accepted_at DESC NULLS LAST
                LIMIT 1
                """
            ), {"gid": gid}).mappings().first()

            if holder:
                operator_username = (holder.get("requested_by") or "").strip() or (holder.get("accepted_by") or "").strip()
                if operator_username:
                    # 3) Resolve operator email
                    user = db.execute(text(
                        """
                        SELECT email, username
                        FROM public.users
                        WHERE TRIM(LOWER(username)) = TRIM(LOWER(:u))
                        LIMIT 1
                        """
                    ), {"u": operator_username}).mappings().first()
                    if user and user.get("email"):
                        subject = "Upcoming Gauge Due Date Reminder"
                        body = (
                            f"Dear {operator_username},\n\n"
                            f"This is a reminder that the gauge assigned to you (Gauge ID: {gid}) is due for return/calibration in 3 days (Due Date: {fmt_date(due_val)}).\n\n"
                            f"Please ensure necessary actions are taken before the due date.\n\n"
                            f"Regards,\n"
                            f"CMTI\n"
                            f"Automated Notification System"
                        )
                        try:
                            send_email(smtp_host, smtp_port, smtp_user, smtp_pass, email_from, user["email"], subject, body)
                            _log_email(db, user["email"], subject, body, "sent", None, {"source": "due_reminder", "gauge_id": gid})
                        except Exception as e:
                            _log_email(db, user.get("email") or "", subject, body, "failed", str(e), {"source": "due_reminder", "gauge_id": gid})
                            # Continue processing others even if one email fails
                            print(f"Failed to email operator {operator_username} for gauge {gid}: {e}", file=sys.stderr)
                        continue

            # Fallback: if not found in gauge_requests, check gauge_tracker current holder
            gt = db.execute(text(
                """
                SELECT u.email, u.username
                FROM public.gauge_tracker gt
                LEFT JOIN public.users u ON u.id = gt.issued_to
                WHERE gt.gauge_id = :gid AND gt.returned_at IS NULL
                ORDER BY gt.issued_at DESC NULLS LAST
                LIMIT 1
                """
            ), {"gid": gid}).mappings().first()
            if gt and gt.get("email"):
                operator_username = (gt.get("username") or "").strip()
                subject = "Upcoming Gauge Due Date Reminder"
                body = (
                    f"Dear {operator_username},\n\n"
                    f"This is a reminder that the gauge assigned to you (Gauge ID: {gid}) is due for return/calibration in 3 days (Due Date: {fmt_date(due_val)}).\n\n"
                    f"Please ensure necessary actions are taken before the due date.\n\n"
                    f"Regards,\n"
                    f"CMTI\n"
                    f"Automated Notification System"
                )
                try:
                    send_email(smtp_host, smtp_port, smtp_user, smtp_pass, email_from, gt["email"], subject, body)
                    _log_email(db, gt["email"], subject, body, "sent", None, {"source": "due_reminder", "gauge_id": gid})
                except Exception as e:
                    _log_email(db, gt.get("email") or "", subject, body, "failed", str(e), {"source": "due_reminder", "gauge_id": gid})
                    print(f"Failed to email operator {operator_username} for gauge {gid} (gt): {e}", file=sys.stderr)
                continue

            # If not assigned or no email found, add to unassigned list
            unassigned.append({"gauge_id": gid, "due": due_val})

        # 4) Email admins for unassigned gauges (single aggregated email)
        if unassigned:
            admins = db.execute(text(
                """
                SELECT email, username FROM public.users
                WHERE role = 'admin' AND email IS NOT NULL AND email <> ''
                """
            )).mappings().all()

            if admins:
                subject = "Unassigned Gauge Due Soon"
                lines = [
                    "Dear Admin,",
                    "",
                    "The following gauge(s) are due in 3 days but are currently not assigned to any operator:",
                    "",
                ]
                for item in unassigned:
                    lines.append(f"- Gauge ID: {item['gauge_id']}, Due Date: {fmt_date(item['due'])}")
                lines.extend(["", "Please review and assign or take necessary action.", "", "Regards,", "CMTI", "Automated Notification System"])
                body = "\n".join(lines)

                for admin in admins:
                    try:
                        send_email(smtp_host, smtp_port, smtp_user, smtp_pass, email_from, admin["email"], subject, body)
                        _log_email(db, admin["email"], subject, body, "sent", None, {"source": "due_reminder", "unassigned_count": len(unassigned)})
                    except Exception as e:
                        _log_email(db, admin.get("email") or "", subject, body, "failed", str(e), {"source": "due_reminder", "unassigned_count": len(unassigned)})
                        print(f"Failed to email admin {admin.get('username')}: {e}", file=sys.stderr)

        db.commit()
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    try:
        code = main()
    except Exception as exc:
        print(f"due_reminder failed: {exc}", file=sys.stderr)
        code = 1
    sys.exit(code)
