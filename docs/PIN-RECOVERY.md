# Forgotten transaction PIN: check and clear it on the server

Run these on the DigitalOcean droplet (Console or SSH). They work on the server
as it is now. Nothing needs to be deployed first.

A PIN is stored only as a salted hash, so it cannot be read back. The fix is to
clear it. The customer then chooses a new one at their next verification.

## 1. Go to the API folder

```bash
cd /var/www/fable/api
```

## 2. Check who has a PIN (read only, changes nothing)

```bash
sqlite3 -header -column data/fable.db "select user_id, institution_id, pin_hash is not null as pin_set, failed_attempts, locked_until from user_security;"
```

- One row per customer. `pin_set` is `1` when they have a PIN.
- `locked_until` has a time when too many wrong attempts locked them out.
- Customer ids look like `meridian_ada` or `union_bank_chioma`.

If you get `sqlite3: command not found`, either install it:

```bash
apt install -y sqlite3
```

or run the same check through the container's Python:

```bash
docker compose exec api python -c "import sqlite3;db=sqlite3.connect('/data/fable.db');[print(r) for r in db.execute('select user_id, institution_id, pin_hash is not null, failed_attempts, locked_until from user_security')]"
```

## 3. Back up the database first

```bash
cp data/fable.db data/fable.db.bak-$(date +%Y%m%d-%H%M%S)
```

## 4. Clear one customer's PIN

Replace `PUT_USER_ID_HERE` with the id from step 2.

```bash
sqlite3 data/fable.db "update user_security set pin_hash=NULL, pin_set_at=NULL, failed_attempts=0, locked_until=NULL where user_id='PUT_USER_ID_HERE';"
```

Clear everyone's PIN instead:

```bash
sqlite3 data/fable.db "update user_security set pin_hash=NULL, pin_set_at=NULL, failed_attempts=0, locked_until=NULL;"
```

## 5. Check it worked

Run the step 2 command again. `pin_set` should now be `0` for that customer.
Open the demo, send a flagged transfer, and it will ask you to choose a new PIN.

## After the next deploy

Once the latest code is deployed (`git pull origin main` then
`docker compose up -d --build`), you also get:

- any 4 or 6 digit PIN is accepted, with no "too easy to guess" rule
- a "Forgot your PIN?" link in the demo, using a code to the registered email
- a **Reset PIN** button on each customer in the console under Agents > Copilot
- `docker compose exec api python scripts/pin_tool.py list` and `... clear <user_id>`
