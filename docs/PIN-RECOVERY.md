# Forgotten transaction PIN: check and clear it on the server

Run these on the DigitalOcean droplet (SSH or the Droplet Console). They work on
the server as it is. Nothing needs to be deployed first, and `sqlite3` does not
need to be installed: the API container already has Python.

A PIN is stored only as a salted hash, so it cannot be read back. The fix is to
clear it. The customer then chooses a new one at their next verification.

## 1. Go to the API folder

```bash
cd /var/www/fable/api
```

## 2. Back up the database properly

The database runs in WAL mode. Recent changes sit in `data/fable.db-wal`, next to
`data/fable.db`, until SQLite folds them in. **A plain `cp data/fable.db ...` copies
only the main file and misses the recent data**, so it is not a backup. Use
SQLite's own backup, which includes everything:

```bash
docker compose exec -T api python -c "import sqlite3,datetime;src=sqlite3.connect('/data/fable.db');name='/data/fable.db.bak-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-full';dst=sqlite3.connect(name);src.backup(dst);dst.close();print('saved',name)"
```

Never delete `fable.db-wal` or `fable.db-shm`. They are part of the live database.

## 3. Check who has a PIN (read only)

```bash
docker compose exec -T api python -c "import sqlite3;[print(r) for r in sqlite3.connect('/data/fable.db').execute('select user_id, institution_id, pin_hash is not null as pin_set, failed_attempts, locked_until from user_security')]"
```

- One row per customer. `pin_set` is `1` when they have a PIN.
- `failed_attempts` of 5 with a `locked_until` time means they are locked out.
- Customer ids are the institution id plus the customer's first name, for example `ecobank_kelechi`. The id is shown on the customer's profile in the console (Customers, then their name), which also has a **Reset PIN** button.

## 4. Clear PINs

Everyone's PIN, which also lifts any lock:

```bash
docker compose exec -T api python -c "import sqlite3;db=sqlite3.connect('/data/fable.db');db.execute('update user_security set pin_hash=NULL, pin_set_at=NULL, failed_attempts=0, locked_until=NULL');db.commit();print('done')"
```

One customer only (put the id in place of `PUT_USER_ID_HERE`):

```bash
docker compose exec -T api python -c "import sqlite3;db=sqlite3.connect('/data/fable.db');db.execute(\"update user_security set pin_hash=NULL, pin_set_at=NULL, failed_attempts=0, locked_until=NULL where user_id='PUT_USER_ID_HERE'\");db.commit();print('done')"
```

## 5. Check it worked

Run step 3 again. `pin_set` should be `0`. Open the demo, send a flagged
transfer, and it will ask the customer to choose a new PIN.

## After the next deploy

Once the latest code is deployed (`git pull origin main` then
`docker compose up -d --build`), you also get:

- PIN rules you control from `api/.env`: `FABLE_PIN_LENGTH` (4 or 6),
  `FABLE_PIN_MAX_ATTEMPTS`, `FABLE_PIN_LOCKOUT_MINUTES` and `FABLE_PIN_BLOCK_WEAK`
- a **Reset PIN** button on each customer in the console under Agents > Copilot,
  which clears the PIN so the customer picks a new one
- `docker compose exec api python scripts/pin_tool.py list` and `... clear <user_id>`

There is no self-service "forgot PIN" for customers. Recovery goes through the
institution, the way it does at a bank.
