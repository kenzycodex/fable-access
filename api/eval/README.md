# Shield evaluation harness

The honest bridge between "explainable weighted rules" and "calibrated on
labelled data".

Shield's signal weights (`agents/shield/weights.py`) are grounded in published
NIBSS/CBN channel fraud statistics and documented Nigerian scam patterns. They
are explainable and defensible, but they are **not** trained on a labelled
dataset, and we don't claim they are. This harness is where an institution
turns confirmed fraud/legit outcomes into a *measured* verdict on those weights.

## Run it

```bash
cd api
python -m eval.harness eval/sample_labeled.csv
```

It reports precision, recall (capture rate), F1, false-positive rate, PR-AUC and
the confusion matrix — the metrics fraud teams use, because raw accuracy on
imbalanced fraud data is misleading. It reuses the exact weights and
channel-specific thresholds the live engine uses, so what it measures is what
runs in production.

## Bring your own data

Replace `sample_labeled.csv` with a real export. One row per historical
transfer, an `is_fraud` label (1/0), and any of the feature columns documented
at the top of `harness.py`. Missing columns are treated as "signal absent".

## What this is and isn't

- **Is:** a way to measure the current rule core against real outcomes, and the
  place to tune weights (via `FABLE_W_*` env overrides) and re-measure.
- **Isn't:** a trained model. Fitting weights from labels — logistic regression
  over the same signal features, kept explainable — is the natural next step,
  and this harness is the evaluation half of that loop. Until an institution
  supplies labels and that loop runs, "calibrated on labelled data" would be a
  claim we can't back, so the deck says "designed to calibrate on your labelled
  outcomes" instead.
