"""Institution branding endpoints.

Read is public — the demo bank fetches it on every page load to render the
bank's own identity. Writes come from the console's settings screen.
"""
import base64
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from core import config
from core.tenancy import require_role
from services import audit
from services.branding import BrandingError, get_branding, resolve_slug, update_branding


def _owner_of(institution_id: str, request: Request) -> dict:
    """Writes need an owner of this institution.

    They needed nothing at all before: anyone could repaint any bank's demo,
    replace its logo or move its public URL with one unauthenticated request.
    Another tenant's session is a 404, so this can't probe who exists.
    """
    who = require_role(request, "owner")
    if who["inst"] != institution_id:
        raise HTTPException(status_code=404, detail="Institution not found")
    return who

router = APIRouter(prefix="/v1/branding", tags=["branding"])

# Raster and vector only. No SVG: it can carry script, and these are rendered
# inside the demo bank's own origin.
ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/webp"}


@router.get("/{institution_id}")
def read(institution_id: str):
    return get_branding(institution_id)


@router.get("/resolve/{slug}")
def resolve(slug: str):
    """Vanity slug -> institution_id, so a renamed tenant's URL still routes."""
    institution_id = resolve_slug(slug)
    if not institution_id:
        raise HTTPException(status_code=404, detail="Unknown institution.")
    return {"institution_id": institution_id, "branding": get_branding(institution_id)}


class BrandingPatch(BaseModel):
    display_name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None
    slug: Optional[str] = None
    support_email: Optional[str] = None
    tagline: Optional[str] = None


@router.patch("/{institution_id}")
def update(institution_id: str, patch: BrandingPatch, request: Request):
    who = _owner_of(institution_id, request)
    # exclude_unset so a form submitting one field can't blank the others.
    changes = patch.model_dump(exclude_unset=True)
    try:
        result = update_branding(institution_id, changes)
    except BrandingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit.record(audit.INSTITUTION_UPDATED, None, institution_id=institution_id,
                 fields=sorted(k for k in changes if k != "logo_url"), area="branding", by=who["email"])
    return result


@router.post("/{institution_id}/logo")
async def upload_logo(institution_id: str, request: Request, file: UploadFile = File(...)):
    """Store a logo as a data URI.

    Deliberately not a filesystem or bucket write: this deployment has no
    object storage or CDN, and inventing a /uploads directory would break the
    moment the app runs on ephemeral storage. Small images inline cleanly.
    """
    _owner_of(institution_id, request)
    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Logo must be a PNG, JPEG or WebP image.",
        )

    data = await file.read()
    if len(data) > config.BRANDING_MAX_LOGO_BYTES:
        limit_kb = config.BRANDING_MAX_LOGO_BYTES // 1024
        raise HTTPException(status_code=413, detail=f"Logo must be under {limit_kb}KB.")
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")

    data_uri = f"data:{file.content_type};base64,{base64.b64encode(data).decode()}"
    try:
        return update_branding(institution_id, {"logo_url": data_uri})
    except BrandingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{institution_id}/logo")
def remove_logo(institution_id: str, request: Request):
    _owner_of(institution_id, request)
    return update_branding(institution_id, {"logo_url": None})
