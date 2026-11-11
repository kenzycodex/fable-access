"""Set up the live demo institution for the Forge cluster by hand.

The API does this by itself at startup when FORGE_DEMO_API_KEY is set (the
normal case in the cluster; see docs/DEPLOY-FORGE.md), so this script is only
needed to run it on demand, or to issue a random key:

    kubectl exec deploy/api -- python scripts/forge_seed.py            # uses FORGE_DEMO_API_KEY if set
    kubectl exec deploy/api -- python scripts/forge_seed.py --new-key  # issue a random key, shown once

A key issued here is shown once and never stored in the clear.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import forge_seed  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--new-key", action="store_true", help="issue a random API key and retire the old ones")
    args = parser.parse_args()

    configured = os.getenv("FORGE_DEMO_API_KEY", "").strip() or None
    result = forge_seed.ensure_demo(None if args.new_key else configured, new_key=args.new_key)
    for ref, cid in result["customers"].items():
        print(f"customer {ref}: {cid}")
    if result["issued_key"]:
        print("FORGE_DEMO_API_KEY (shown once):", result["issued_key"])
    elif configured and not args.new_key:
        print("The configured FORGE_DEMO_API_KEY is in place.")
    else:
        print("An API key already exists. Run with --new-key to issue another.")


if __name__ == "__main__":
    main()
