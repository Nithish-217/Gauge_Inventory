#!/usr/bin/env python3
"""
Test script to verify email configuration is working correctly
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

def test_email_config():
    # Load environment variables
    load_dotenv()
    
    smtp_host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("EMAIL_PORT", "587"))
    smtp_user = os.getenv("EMAIL_USER")
    smtp_pass = "ssmn ebot hmhi cqen"  # Test with new app password
    email_from = os.getenv("EMAIL_FROM", smtp_user or "")
    
    print("Email Configuration Test")
    print("=" * 40)
    print(f"SMTP Host: {smtp_host}")
    print(f"SMTP Port: {smtp_port}")
    print(f"Email User: {smtp_user}")
    print(f"Email From: {email_from}")
    print(f"Password Set: {'Yes' if smtp_pass else 'No'}")
    print("=" * 40)
    
    if not smtp_user or not smtp_pass:
        print("ERROR: Email credentials not configured")
        return False
    
    try:
        print("\nTesting SMTP connection...")
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        print("SMTP connection successful!")
        server.quit()
        return True
    except Exception as e:
        print(f"SMTP connection failed: {str(e)}")
        return False

if __name__ == "__main__":
    success = test_email_config()
    if success:
        print("\nEmail configuration is working correctly!")
    else:
        print("\nEmail configuration has issues.")
        print("Please check your credentials and try again.")