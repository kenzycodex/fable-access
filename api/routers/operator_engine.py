"""The operator console's Engine page (see services/engine_admin.py).

Reading needs any operator. Drafting and backtesting need a platform admin.
Proposing, approving, shadow, promotion and rollback need a platform owner and
a fresh step-up (passkey preferred, authenticator code accepted), the same as
Environment. Rejecting or cancelling needs no step-up: stopping a change must
be quick, and it can only ever leave things as they are.
"""
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from core import operator_stepup, operators
from routers.operator_secrets import StepUp, _limited, _no_store
from services import engine_admin

router = APIRouter(prefix="/operator/engine", tags=["operator-engine"], dependencies=[Depends(_no_store)])


def _admin(request: Request) -> dict:
    op = operators.require(request, "platform_admin")
    _limited(op)
    return op


def _owner(request: Request, step_up: StepUp | None) -> dict:
    op = operators.require(request, "platform_owner")
    _limited(op)
    operator_stepup.verify(op, step_up.model_dump() if step_up else None)
    return op


class Draft(BaseModel):
    params: dict
    note: str | None = Field(None, max_length=500)


class Backtest(BaseModel):
    days: int = 30


class Propose(BaseModel):
    note: str | None = Field(None, max_length=500)
    drift_note: str | None = Field(None, max_length=500)
    acknowledge_impact: bool = False
    step_up: StepUp


class Approve(BaseModel):
    acknowledge_impact: bool = False
    step_up: StepUp


class Reject(BaseModel):
    reason: str | None = Field(None, max_length=300)


class Shadow(BaseModel):
    days: int = Field(engine_admin.SHADOW_DAYS_DEFAULT, ge=1, le=engine_admin.SHADOW_DAYS_MAX)
    step_up: StepUp


class Owner(BaseModel):
    step_up: StepUp


class Rollback(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=5, max_length=300)
    step_up: StepUp


@router.get("")
def overview(request: Request):
    """Active, shadow and draft versions, history, bounds and what the environment manages."""
    op = operators.require(request, "support")
    out = engine_admin.overview()
    out["me"] = {"role": op.get("role"), "email": op["email"],
                 "can_draft": op.get("role") in ("platform_admin", "platform_owner"),
                 "can_decide": op.get("role") == "platform_owner"}
    return out


@router.get("/versions/{version}")
def version(version: int, request: Request):
    operators.require(request, "support")
    return engine_admin.version_detail(version)


@router.get("/shadow-diff")
def shadow_diff(request: Request, limit: int = Query(50, ge=1, le=200)):
    operators.require(request, "support")
    return engine_admin.shadow_diff(limit=limit) or {"version": None, "scored": 0, "disagreements": 0, "recent": []}


@router.post("/drafts")
def create_draft(body: Draft, request: Request):
    return engine_admin.create_draft(_admin(request), body.params, body.note)


@router.put("/versions/{version}")
def update_draft(version: int, body: Draft, request: Request):
    return engine_admin.update_draft(_admin(request), version, body.params, body.note)


@router.post("/versions/{version}/backtest")
def backtest(version: int, body: Backtest, request: Request):
    return engine_admin.run_backtest(_admin(request), version, body.days)


@router.post("/versions/{version}/propose")
def propose(version: int, body: Propose, request: Request):
    op = _owner(request, body.step_up)
    return engine_admin.propose(op, version, body.note, body.drift_note, body.acknowledge_impact)


@router.post("/versions/{version}/approve")
def approve(version: int, body: Approve, request: Request):
    op = _owner(request, body.step_up)
    return engine_admin.approve(op, version, body.acknowledge_impact)


@router.post("/versions/{version}/reject")
def reject(version: int, body: Reject, request: Request):
    op = operators.require(request, "platform_admin")
    _limited(op)
    if engine_admin.status(version) != "draft":
        op = operators.require(request, "platform_owner")
    return engine_admin.reject(op, version, (body.reason or "").strip() or None)


@router.post("/versions/{version}/shadow")
def shadow(version: int, body: Shadow, request: Request):
    return engine_admin.start_shadow(_owner(request, body.step_up), version, body.days)


@router.post("/versions/{version}/shadow/stop")
def stop_shadow(version: int, request: Request):
    """Stopping shadow changes no decision, so it needs no step-up."""
    op = operators.require(request, "platform_owner")
    _limited(op)
    return engine_admin.stop_shadow(op, version)


@router.post("/versions/{version}/promote")
def promote(version: int, body: Owner, request: Request):
    return engine_admin.promote(_owner(request, body.step_up), version)


@router.post("/rollback")
def rollback(body: Rollback, request: Request):
    return engine_admin.rollback(_owner(request, body.step_up), body.version, body.reason.strip())
