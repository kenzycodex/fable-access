"""Per-institution branding.

A bank's customers should see their bank, not Fable. The demo bank reads this
on every page load and falls back to Fable defaults for anything unset, so a
tenant that never touches settings still renders correctly.

The slug is the one field with a cooling period. It is the public URL already
printed in a welcome email and possibly shared with customers, so renaming it
breaks live links — the lock makes that a deliberate act rather than an
afternoon's fiddling. The window is configurable because what counts as
"disruptive" differs between a sandbox and a production tenant.
"""
import re
from datetime import datetime, timedelta, timezone

import config
from db import cursor, row_to_dict

# Reserved so a vanity slug can never shadow a real route or another tenant.
RESERVED_SLUGS = {
    "demo", "dashboard", "api", "admin", "login", "logout", "settings",
    "platform", "pricing", "why-fable", "docs", "health", "static", "public",
    "assets", "images", "fable", "v1",
}

SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$")

HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

DEFAULTS = {
    "primary_color": "#7C3AED",
    "accent_color": "#00D4FF",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class BrandingError(ValueError):
    """Rejected input, with a message meant for the person editing settings."""


def get_branding(institution_id: str) -> dict:
    """Branding for a tenant, merged over Fable defaults."""
    with cursor() as cur:
        cur.execute("SELECT * FROM institution_branding WHERE institution_id = ?", (institution_id,))
        row = row_to_dict(cur.fetchone()) or {}

    locked_until = row.get("slug_locked_until")
    return {
        "institution_id": institution_id,
        "display_name": row.get("display_name"),
        "logo_url": row.get("logo_url"),
        "primary_color": row.get("primary_color") or DEFAULTS["primary_color"],
        "accent_color": row.get("accent_color") or DEFAULTS["accent_color"],
        "slug": row.get("slug") or institution_id,
        "support_email": row.get("support_email"),
        "tagline": row.get("tagline"),
        "updated_at": row.get("updated_at"),
        "slug_locked_until": locked_until,
        "slug_locked": _slug_locked(locked_until),
        "slug_lock_days": config.BRANDING_SLUG_LOCK_DAYS,
    }


def _slug_locked(locked_until: str | None) -> bool:
    if not locked_until:
        return False
    try:
        return datetime.fromisoformat(locked_until) > _now()
    except ValueError:
        return False


def resolve_slug(slug: str) -> str | None:
    """Map a vanity slug back to its institution_id.

    Checks the branding table first so a renamed tenant keeps working, then
    falls back to treating the value as an institution_id directly — which is
    what every tenant that never customised its URL still uses.
    """
    with cursor() as cur:
        cur.execute("SELECT institution_id FROM institution_branding WHERE slug = ?", (slug,))
        row = cur.fetchone()
        if row:
            return row["institution_id"]
        cur.execute("SELECT institution_id FROM institutions WHERE institution_id = ?", (slug,))
        row = cur.fetchone()
        return row["institution_id"] if row else None


def _validate_slug(slug: str, institution_id: str) -> str:
    slug = slug.strip().lower()
    if not SLUG_PATTERN.match(slug):
        raise BrandingError(
            "Use 3–40 characters: lowercase letters, numbers, hyphens or underscores, "
            "starting and ending with a letter or number."
        )
    if slug in RESERVED_SLUGS:
        raise BrandingError(f"'{slug}' is reserved. Pick a different URL.")

    # Free if it's already ours; rejected if it belongs to someone else.
    with cursor() as cur:
        cur.execute(
            "SELECT institution_id FROM institution_branding WHERE slug = ? AND institution_id != ?",
            (slug, institution_id),
        )
        if cur.fetchone():
            raise BrandingError("That URL is already taken.")
        cur.execute(
            "SELECT institution_id FROM institutions WHERE institution_id = ? AND institution_id != ?",
            (slug, institution_id),
        )
        if cur.fetchone():
            raise BrandingError("That URL is already taken.")
    return slug


def _validate_color(value: str | None, field: str) -> str | None:
    if value is None or value == "":
        return None
    value = value.strip()
    if not HEX_COLOR.match(value):
        raise BrandingError(f"{field} must be a hex colour like #7C3AED.")
    return value.upper()


def update_branding(institution_id: str, patch: dict) -> dict:
    """Apply a settings change, enforcing the slug lock.

    Only keys present in `patch` are touched, so a form that submits one field
    can't blank the rest.
    """
    current = get_branding(institution_id)
    updates: dict = {}

    if "slug" in patch and patch["slug"]:
        new_slug = _validate_slug(patch["slug"], institution_id)
        if new_slug != current["slug"]:
            if current["slug_locked"]:
                until = current["slug_locked_until"]
                raise BrandingError(
                    f"Your URL was changed recently and is locked until {until[:10]}. "
                    "This protects links already shared with your customers."
                )
            updates["slug"] = new_slug
            updates["slug_locked_until"] = (
                _now() + timedelta(days=config.BRANDING_SLUG_LOCK_DAYS)
            ).isoformat()

    if "primary_color" in patch:
        updates["primary_color"] = _validate_color(patch["primary_color"], "Primary colour")
    if "accent_color" in patch:
        updates["accent_color"] = _validate_color(patch["accent_color"], "Accent colour")

    for field in ("display_name", "logo_url", "support_email", "tagline"):
        if field in patch:
            value = (patch[field] or "").strip() or None
            if field == "display_name" and value and len(value) > 60:
                raise BrandingError("Display name must be 60 characters or fewer.")
            updates[field] = value

    if not updates:
        return current

    updates["updated_at"] = _now().isoformat()

    with cursor() as cur:
        cur.execute(
            "INSERT OR IGNORE INTO institution_branding (institution_id) VALUES (?)",
            (institution_id,),
        )
        assignments = ", ".join(f"{k} = ?" for k in updates)
        cur.execute(
            f"UPDATE institution_branding SET {assignments} WHERE institution_id = ?",
            [*updates.values(), institution_id],
        )

    return get_branding(institution_id)
