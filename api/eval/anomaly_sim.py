"""Simulated customers for the anomaly model. Not real-world data.

Every number this prints is measured on synthetic customers built here, to
compare the anomaly models with each other. None of it says how either model
performs on a real bank's customers; only labelled outcomes can say that.

How the simulation is built (fixed seed, so every run prints the same):

  * CUSTOMERS customers. Each has a usual amount range: a low end drawn
    uniformly from NGN 1,000 to NGN 50,000, and a high end 2 to 8 times that.
  * Each has a usual active window: it starts at a random hour from 07:00 to
    14:00 and lasts 4, 8 or 12 hours.
  * Each has a history of 8, 15, 40 or 120 past transfers (chosen at random),
    every one with an amount drawn uniformly from the range and an hour drawn
    uniformly from the window.
  * "Typical" test transfers: TYPICAL_PER_CUSTOMER more transfers drawn from the
    same range and window. A model should add nothing to these.
  * "Odd" test transfers, three per customer:
      small at night   a fifth of the low end, in the middle of the customer's
                       quiet hours (the hours outside their window)
      usual at night   the high end, in the middle of their quiet hours
      large in hours   three times the high end, at the start of the window
  * A transfer "adds points" when the model's value times the default weight
    (0.10) passes the engine's 0.02 gate, exactly as in scoring.

Run:  python -m eval.anomaly_sim
"""
from __future__ import annotations

import random
from collections import defaultdict

from agents.shield.anomaly import GATE, current_anomaly, previous_anomaly

SEED = 7
CUSTOMERS = 200
TYPICAL_PER_CUSTOMER = 20
HISTORY_SIZES = (8, 15, 40, 120)
WEIGHT = 0.10


def _customer(rng: random.Random):
    lo = rng.uniform(1_000, 50_000)
    hi = lo * rng.uniform(2, 8)
    start = rng.choice(range(7, 15))
    span = rng.choice((4, 8, 12))
    n = rng.choice(HISTORY_SIZES)
    amounts = [rng.uniform(lo, hi) for _ in range(n)]
    hours = [(start + rng.randrange(span)) % 24 for _ in range(n)]
    return lo, hi, start, span, amounts, hours


def run(seed: int = SEED, customers: int = CUSTOMERS) -> dict:
    rng = random.Random(seed)
    typical = defaultdict(lambda: {"n": 0, "current": 0, "previous": 0})
    odd = {k: {"n": 0, "current": 0, "previous": 0} for k in ("small at night", "usual at night", "large in hours")}
    for c in range(customers):
        lo, hi, start, span, amounts, hours = _customer(rng)
        key = f"sim-{c}"
        for _ in range(TYPICAL_PER_CUSTOMER):
            a, h = rng.uniform(lo, hi), (start + rng.randrange(span)) % 24
            row = typical[len(amounts)]
            row["n"] += 1
            row["current"] += current_anomaly(amounts, hours, a, h, cache_key=key) * WEIGHT > GATE
            row["previous"] += previous_anomaly(amounts, hours, a, h, cache_key=key) * WEIGHT > GATE
        quiet = (start + span + (24 - span) // 2) % 24
        for name, (a, h) in {
            "small at night": (lo * 0.2, quiet),
            "usual at night": (hi, quiet),
            "large in hours": (hi * 3, start),
        }.items():
            odd[name]["n"] += 1
            odd[name]["current"] += current_anomaly(amounts, hours, a, h, cache_key=key) * WEIGHT > GATE
            odd[name]["previous"] += previous_anomaly(amounts, hours, a, h, cache_key=key) * WEIGHT > GATE
    return {"typical": dict(typical), "odd": odd}


def _pct(part: int, whole: int) -> str:
    return f"{100 * part / whole:.1f}%" if whole else "-"


def main() -> None:
    result = run()
    print("Simulated customers, not real-world data. See the module docstring for how they are built.\n")
    print("Typical transfers that add points (lower is better)")
    print(f"{'history':>8} {'transfers':>10} {'current':>9} {'previous':>9}")
    totals = {"n": 0, "current": 0, "previous": 0}
    for size in sorted(result["typical"]):
        row = result["typical"][size]
        for k in totals:
            totals[k] += row[k]
        print(f"{size:>8} {row['n']:>10} {_pct(row['current'], row['n']):>9} {_pct(row['previous'], row['n']):>9}")
    print(f"{'all':>8} {totals['n']:>10} {_pct(totals['current'], totals['n']):>9} "
          f"{_pct(totals['previous'], totals['n']):>9}\n")
    print("Odd transfers that add points (higher is better)")
    for name, row in result["odd"].items():
        print(f"  {name:<16} current {_pct(row['current'], row['n']):>7}   previous {_pct(row['previous'], row['n']):>7}")


if __name__ == "__main__":
    main()
