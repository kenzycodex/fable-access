from agents.copilot.baseline import get_user_baseline, format_hours


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
            "what_we_dont_store": [
                "Your messages or call content",
                "Exact GPS coordinates (only general area)",
                "Card numbers, CVVs, or PINs",
                "Any data sold to third parties",
            ],
            "your_controls": {
                "can_reset_baseline": True,
                "can_disable_location": True,
                "can_disable_device_tracking": True,
                "can_export_data": True,
                "can_delete_all_data": True,
            },
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
        "what_we_dont_store": [
            "Your messages or call content",
            "Exact GPS coordinates (only general area)",
            "Card numbers, CVVs, or PINs",
            "Any data sold to third parties",
        ],
        "your_controls": {
            "can_reset_baseline": True,
            "can_disable_location": True,
            "can_disable_device_tracking": True,
            "can_export_data": True,
            "can_delete_all_data": True,
        },
    }
