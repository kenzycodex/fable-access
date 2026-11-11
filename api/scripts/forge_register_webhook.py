"""Register Fable's webhook receiver with the Xtradot Bank sandbox.

Run once inside the API pod, so the call comes from the cluster:

    kubectl exec deploy/api -- python scripts/forge_register_webhook.py

The bank returns the signing secret once, at registration. It is printed here
once and never stored by Fable: copy it into the cluster secret straight away
(docs/DEPLOY-FORGE.md), then restart the API. Do not paste it anywhere else.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import forge_bank  # noqa: E402

URL = os.getenv("FORGE_WEBHOOK_URL", "http://api.team11.svc.cluster.local/v1/forge/hooks/bank")
EVENTS = ["transfer.pending", "transfer.successful", "transfer.failed", "transfer.reversed",
          "transfer.bulk.completed"]


def main() -> None:
    existing = forge_bank._call("GET", "/webhooks").data  # noqa: SLF001 - an operator script
    hooks = existing.get("webhooks", existing) if isinstance(existing, dict) else existing
    if any(h.get("url") == URL for h in hooks or []):
        raise SystemExit(f"{URL} is already registered. Delete it first if you need a new secret.")
    data = forge_bank._call("POST", "/webhooks", {"url": URL, "events": EVENTS}).data  # noqa: SLF001
    print("Registered:", URL)
    print("webhook_secret (shown once):", data.get("webhook_secret"))


if __name__ == "__main__":
    main()
