import sqlite3
import secrets
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import hash_password
from db import get_conn, cursor

email = "risk@meridian.ng"
password = "fable-demo"
institution_id = "meridian"
institution_name = "Meridian MFB"
api_key = f"fbl_live_{secrets.token_hex(16)}"

with cursor() as cur:
    cur.execute("SELECT * FROM admins WHERE email = ?", (email,))
    if not cur.fetchone():
        hashed = hash_password(password)
        cur.execute("INSERT INTO admins (email, institution_id, hashed_password) VALUES (?, ?, ?)", (email, institution_id, hashed))
        cur.execute("INSERT INTO api_keys (key, institution_name, admin_email) VALUES (?, ?, ?)", (api_key, institution_name, email))
        print(f"Demo user {email} seeded successfully.")
    else:
        print(f"Demo user {email} already exists.")
