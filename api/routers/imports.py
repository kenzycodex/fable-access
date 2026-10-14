"""Importing a bank's customers and past transfers.

Two ways in, one validator (services/imports.py):

  * the console: upload a CSV, review what passed and what didn't, then apply;
  * the API: JSON batches from the bank's own servers, applied at once.

Imports change what Fable knows about real customers, so they need the
institution's owner, or the institution's API key for a system integration.
"""
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from core.tenancy import console_identity, institution_mode, require_role
from services import imports

router = APIRouter(prefix="/v1/imports", tags=["imports"])


def _importer(request: Request) -> dict:
    """The owner, or the institution's API key."""
    who = console_identity(request)
    if who["role"] not in ("owner", "service"):
        raise HTTPException(status_code=403, detail="Only an owner can import data.")
    return who


def _kind(kind: str) -> str:
    if kind not in imports.KINDS:
        raise HTTPException(status_code=404, detail="Import kind must be customers or transactions.")
    return kind


@router.get("/templates/{kind}.csv")
def template(kind: str, request: Request):
    """A CSV with the expected columns and an example row."""
    require_role(request, "viewer")
    return Response(
        imports.template_csv(_kind(kind)),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="fable-{kind}-template.csv"'},
    )


@router.get("/summary")
def summary(request: Request):
    """How many customers and past transfers this institution has in Fable."""
    return imports.summary(require_role(request, "viewer")["inst"])


@router.get("")
def jobs(request: Request):
    """Recent CSV imports, newest first."""
    return {"imports": imports.list_jobs(require_role(request, "viewer")["inst"])}


class Batch(BaseModel):
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=imports.MAX_ROWS_PER_BATCH)


@router.post("/{kind}")
def batch(kind: str, body: Batch, request: Request):
    """Validate and apply up to 1,000 rows at once. A reference already imported
    is skipped, so a batch can be retried safely."""
    who = _importer(request)
    try:
        return imports.import_batch(
            who["inst"], _kind(kind), body.rows,
            sandbox=institution_mode(who["inst"]) != "live", actor=who["email"],
        )
    except imports.ImportError_ as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{kind}/csv")
async def upload(kind: str, request: Request, file: UploadFile = File(...)):
    """Validate an uploaded CSV and stage it. Nothing changes until it is applied."""
    who = _importer(request)
    _kind(kind)
    raw = await file.read(imports.MAX_FILE_BYTES + 1)
    try:
        return imports.create_job(
            who["inst"], kind, file.filename or "upload.csv", raw,
            sandbox=institution_mode(who["inst"]) != "live", actor=who["email"],
        )
    except imports.ImportError_ as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{job_id}")
def job(job_id: str, request: Request):
    found = imports.get_job(require_role(request, "viewer")["inst"], job_id)
    if not found:
        raise HTTPException(status_code=404, detail="Import not found.")
    return found


@router.post("/{job_id}/apply")
def apply(job_id: str, request: Request):
    """Apply a validated import in the background. Poll the job for progress."""
    who = _importer(request)
    started = imports.start_apply(who["inst"], job_id, who["email"])
    if not started:
        raise HTTPException(status_code=409, detail="This import is not waiting to be applied.")
    return started


@router.delete("/{job_id}")
def discard(job_id: str, request: Request):
    who = _importer(request)
    if not imports.discard_job(who["inst"], job_id):
        raise HTTPException(status_code=409, detail="Only an import waiting to be applied can be discarded.")
    return {"id": job_id, "status": "discarded"}
