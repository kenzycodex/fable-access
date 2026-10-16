from agents.copilot.baseline import format_hours, get_user_baseline

# What Fable does not keep. Only true statements: device location is stored
# when the customer allows it, so it is not listed here.
WHAT_WE_DONT_STORE = [
    "Your messages or call content",
    "Card numbers or CVVs",
    "Your PIN in readable form (only a one-way hash)",
    "Any data sold to third parties",
]


def your_controls() -> dict:
    """What a customer can do about their own data today. Every flag is false
    until the control exists; the keys are kept so existing clients still parse
    the response. Requests for a copy or erasure go through the customer's bank."""
    return {
        "can_reset_baseline": False,
        "can_disable_location": False,
        "can_disable_device_tracking": False,
        "can_export_data": False,
        "can_delete_all_data": False,
        "how_to_request": "Ask your bank for a copy of your data or for it to be deleted.",
    }


def get_transparency_data(user_id: str) -> dict:
    baseline = get_user_baseline(user_id)

    if not baseline:
        return {
            "user_id": user_id,
            "what_we_know": {
                "typical_transfer_range": "Not enough history yet",
                "active_hours": "Not enough history yet",
                "trusted_recipients_count": 0,
                "known_devices_count": 0,
                "preferred_channel": "N/A",
                "transactions_analyzed": 0,
            },
            "what_we_dont_store": WHAT_WE_DONT_STORE,
            "your_controls": your_controls(),
        }

    low = max(baseline["avg_amount"] * 0.3, 0)
    high = baseline["max_typical_amount"]

    return {
        "user_id": user_id,
        "what_we_know": {
            "typical_transfer_range": f"₦{low:,.0f} – ₦{high:,.0f}",
            "active_hours": format_hours(baseline["typical_hours"]),
            "trusted_recipients_count": len(baseline["known_recipients"]),
            "known_devices_count": max(len(baseline["known_devices"]), 1),
            "preferred_channel": baseline["preferred_channel"],
            "transactions_analyzed": baseline["transaction_count"],
        },
        "what_we_dont_store": WHAT_WE_DONT_STORE,
        "your_controls": your_controls(),
    }
