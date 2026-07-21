"""Shield calibration + evaluation harness.

This is the honest bridge between "explainable weighted rules" and "calibrated
on labelled data". Today Shield's weights are grounded in published NIBSS/CBN
channel statistics and documented scam patterns — defensible, but not measured.
This harness is where an institution turns confirmed fraud/legit outcomes into
a *measured* verdict on those weights, without anyone having to claim a number
they can't show.

Give it a labelled CSV (one row per historical transfer, a chosen `is_fraud`
column, and the feature columns below) and it reports precision, recall, F1,
PR-AUC and the confusion matrix at Shield's channel-specific thresholds — the
metrics fraud teams actually use, because raw accuracy on imbalanced fraud data
misleads.

    python -m eval.harness eval/sample_labeled.csv

It deliberately reuses the same weights and thresholds the live engine uses
(`agents.shield.weights`), so what it measures is what runs in production. It
does not invent an accuracy figure; it computes one from whatever labels you
supply, or refuses if you supply none.

Feature columns (all optional; missing = signal absent):
  channel            one of mobile_app|ussd|pos|internet|atm|qr|branch
  amount_mult        transfer amount ÷ the customer's baseline average
  new_recipient      1/0   first transfer to this account
  time_anomaly       1/0   outside the customer's typical hours
  device_anomaly     1/0   unrecognised device
  location_anomaly   1/0   new city / country
  scam_pattern       1/0   narration matched a Nigerian scam script
  velocity           integer  transfers in the recent window
  failed_verify      integer  recent failed identity checks
  is_large           1/0   large relative to baseline (gates some signals)
  is_fraud           1/0   THE LABEL
"""
import csv
import sys

from agents.shield.channel_risk import get_channel_risk
from agents.shield.weights import WEIGHTS, amount_anomaly_boost, thresholds_for


def score_row(row: dict) -> float:
    """Apply Shield's deterministic weighted-rule core to one feature row.

    Mirrors the live analyzer's additive scoring for the signals a labelled
    export can carry. The ML/behavioral layers that need raw session data are
    out of scope here — this measures the rule core that calibration tunes.
    """
    def flag(name: str) -> bool:
        return str(row.get(name, "")).strip() in ("1", "true", "True", "yes")

    def num(name: str, default: float = 0.0) -> float:
        try:
            return float(row.get(name) or default)
        except ValueError:
            return default

    is_large = flag("is_large")
    score = 0.0

    mult = num("amount_mult")
    if mult > 3:
        score += amount_anomaly_boost(round(mult))[0]
    if flag("new_recipient"):
        score += WEIGHTS["new_recipient"]
    if flag("time_anomaly"):
        score += WEIGHTS["time_anomaly"]
    channel_boost = get_channel_risk(row.get("channel") or "mobile_app")
    if channel_boost > 0.05:
        score += channel_boost
    if flag("device_anomaly"):
        score += WEIGHTS["device_anomaly_large"] if is_large else WEIGHTS["device_anomaly"]
    if flag("location_anomaly"):
        score += WEIGHTS["location_city_large"] if is_large else WEIGHTS["location_city"]
    if flag("scam_pattern"):
        score += 0.15  # representative narration weight (patterns vary 0.08–0.25)

    velocity = int(num("velocity"))
    if velocity >= 5:
        score += WEIGHTS["velocity_high"]
    elif velocity >= 3:
        score += WEIGHTS["velocity"]

    failed = int(num("failed_verify"))
    if failed >= 3:
        score += WEIGHTS["failed_verification_high"] if is_large else WEIGHTS["failed_verification_large"]
    elif failed > 0 and is_large:
        score += WEIGHTS["failed_verification"]

    return min(round(score, 3), 1.0)


def _decision(score: float, channel: str | None) -> str:
    th = thresholds_for(channel)
    return "BLOCK" if score >= th["block"] else "FLAG" if score >= th["flag"] else "PASS"


def evaluate(path: str) -> dict:
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise SystemExit("No rows to evaluate.")
    if "is_fraud" not in rows[0]:
        raise SystemExit("No 'is_fraud' label column — nothing to measure against.")

    scores, labels, caught = [], [], 0
    tp = fp = tn = fn = 0
    for r in rows:
        s = score_row(r)
        label = str(r.get("is_fraud", "")).strip() in ("1", "true", "True", "yes")
        # "Caught" = FLAG or BLOCK (the transfer met friction).
        flagged = _decision(s, r.get("channel")) != "PASS"
        scores.append(s)
        labels.append(1 if label else 0)
        if label and flagged:
            tp += 1
        elif label and not flagged:
            fn += 1
        elif not label and flagged:
            fp += 1
        else:
            tn += 1
        caught += 1 if (label and flagged) else 0

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    fpr = fp / (fp + tn) if (fp + tn) else 0.0

    pr_auc = None
    try:
        from sklearn.metrics import average_precision_score

        if any(labels) and not all(labels):
            pr_auc = round(float(average_precision_score(labels, scores)), 4)
    except Exception:
        pr_auc = None

    return {
        "n": len(rows),
        "fraud": sum(labels),
        "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "false_positive_rate": round(fpr, 4),
        "pr_auc": pr_auc,
    }


def _print(report: dict) -> None:
    print("Shield evaluation")
    print("=================")
    print(f"transfers          {report['n']}   (fraud: {report['fraud']})")
    c = report["confusion"]
    print(f"confusion          tp={c['tp']} fp={c['fp']} tn={c['tn']} fn={c['fn']}")
    print(f"precision          {report['precision']}")
    print(f"recall (capture)   {report['recall']}")
    print(f"F1                 {report['f1']}")
    print(f"false-positive rate {report['false_positive_rate']}")
    print(f"PR-AUC             {report['pr_auc'] if report['pr_auc'] is not None else 'n/a (need both classes + sklearn)'}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: python -m eval.harness <labelled.csv>")
    _print(evaluate(sys.argv[1]))
