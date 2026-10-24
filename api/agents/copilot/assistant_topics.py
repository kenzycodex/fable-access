"""Topics, follow-up suggestions and model-free answers for Ask Fable.

Suggestions are built from the institution's own figures, so each one is a
question the data can actually answer, and they are chosen so a conversation
keeps moving: one deeper follow-up on what was just asked, then topics not yet
covered. Anything the analyst has already asked, and any chip already shown
in this conversation, is not offered again.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from agents.copilot.assistant_facts import change, hour_label, naira

# Checked in order; the topic with the most matches wins, ties go to the first.
_TOPICS: list[tuple[str, re.Pattern]] = [(t, re.compile(p, re.I)) for t, p in [
    ("recent", r"\b(latest|most recent|last (block|flag|transfer|decision)s?|that transfer|walk me through|why was)\b"),
    ("ghost", r"\b(ghost|holds?|held|cooling|cancel\w*|releas\w*)\b"),
    ("queue", r"\b(queue|reviews?|cases?|escalat\w*|analysts?|backlog)\b"),
    ("policy", r"\b(polic(y|ies)|thresholds?|rules?|tighten\w*|loosen\w*|too (strict|lenient|much|many|little))\b"),
    ("timing", r"\b(hours?|time of day|night|morning|evening|weekend|riskiest time)\b"),
    ("trend", r"\b(this week|last week|trend\w*|compar\w*|increas\w*|decreas\w*|grow\w*|shrink\w*|rising|falling|spik\w*)\b"),
    ("patterns", r"\b(scams?|patterns?|scripts?|threats?|social engineering)\b"),
    ("channels", r"\b(channels?|ussd|pos|web|mobile app|internet banking|atm|qr)\b"),
    ("money", r"\b(prevent\w*|saved?|loss(es)?|lost|how much|money|naira|largest|biggest (transfer|block))\b"),
    ("customers", r"\b(customers?|baselines?|profiles?|imports?|history)\b"),
    ("decisions", r"\b(block\w*|flag\w*|scor\w*|signals?|decisions?|decide\w*)\b"),
    ("onboarding", r"\b(go live|going live|set ?up|onboard\w*|get started|api key|webhooks?)\b"),
]]

# Where a conversation naturally goes next from each topic.
_RELATED = {
    "patterns": ("channels", "decisions"),
    "channels": ("policy", "patterns"),
    "decisions": ("recent", "policy"),
    "recent": ("decisions", "queue"),
    "trend": ("patterns", "channels"),
    "queue": ("recent", "decisions"),
    "ghost": ("policy", "money"),
    "money": ("ghost", "trend"),
    "customers": ("onboarding", "decisions"),
    "policy": ("decisions", "ghost"),
    "timing": ("channels", "policy"),
    "onboarding": ("customers", "policy"),
}

# Which topics lead the starters on each console page.
_PAGE_TOPICS = {
    "overview": ("trend", "money", "patterns", "queue"),
    "review": ("queue", "recent", "decisions", "patterns"),
    "transactions": ("recent", "channels", "timing", "trend"),
    "customers": ("customers", "decisions", "onboarding", "ghost"),
    "agents": ("decisions", "ghost", "customers", "policy"),
    "intelligence": ("patterns", "channels", "timing", "trend"),
    "compliance": ("money", "queue", "trend", "ghost"),
    "settings": ("policy", "onboarding", "customers", "ghost"),
}


def topic_of(message: str) -> str | None:
    best, best_hits = None, 0
    for topic, pattern in _TOPICS:
        hits = len(pattern.findall(message or ""))
        if hits > best_hits:
            best, best_hits = topic, hits
    return best


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9₦]+", " ", str(text).lower()).strip()


@dataclass(frozen=True)
class Candidate:
    topic: str
    text: str
    weight: float


def candidates(f: dict) -> list[Candidate]:
    """Every follow-up this institution's data can answer, with how much it matters now."""
    s, w, q, g, c, p = f["summary"], f["week"], f["queue"], f["ghost"], f["customers"], f["policy"]
    out: list[Candidate] = []

    def add(topic: str, text: str, weight: float) -> None:
        # A chip belongs to the topic its own words read as, since that is how
        # the answer to it is chosen when there is no model.
        out.append(Candidate(topic_of(text) or topic, text, weight))

    if not s["transactions_analyzed"]:
        add("onboarding", "What does Fable need before we go live?", 0.9)
        add("customers", "How do I import customers and their history?", 0.85)
        add("decisions", "How does Fable decide to block a transfer?", 0.7)
        add("ghost", "What happens when Ghost holds a transfer?", 0.6)
        add("policy", "What risk thresholds are we using?", 0.5)
        return out

    if q["open"] or q["escalated"]:
        add("queue", "What should my team review first?", 0.95)
    if q["escalated"]:
        add("queue", f"Why are {q['escalated']} cases escalated?", 0.8)
    if q["resolved"]:
        add("queue", "How quickly are we closing review cases?", 0.35)

    recent_block = next((r for r in f["recent"] if r["action"] == "BLOCK"), None)
    if recent_block:
        add("recent", f"Why was the {naira(recent_block['amount'])} transfer blocked?", 0.9)
    if len(f["recent"]) >= 3:
        add("recent", "What do the latest risky transfers have in common?", 0.6)

    if w["blocked"] != w["prev_blocked"] and (w["blocked"] or w["prev_blocked"]):
        add("trend", f"Why are blocks {change(w['blocked'], w['prev_blocked'])} this week?", 0.85)
    add("trend", "How does this week compare with last week?", 0.5)

    if f["patterns"]:
        add("patterns", f"Why is the {f['patterns'][0]['label']} scam hitting us most?", 0.8)
        add("patterns", "Which scam scripts should we warn customers about?", 0.55)
        if len(f["patterns"]) > 1:
            add("patterns", f"How common is the {f['patterns'][1]['label']} scam for us?", 0.4)

    if f["channels"]:
        riskiest = max(f["channels"], key=lambda x: x["risk_rate"])
        busiest = f["channels"][0]
        add("channels", f"Should the {riskiest['label']} channel get stricter checks?", 0.7)
        if busiest["label"] != riskiest["label"]:
            add("channels", f"How risky is the {busiest['label']} channel for its volume?", 0.45)

    if f["signals"]:
        add("decisions", f"Why does the {f['signals'][0]['label']} signal fire so often?", 0.65)
        if len(f["signals"]) > 1:
            add("decisions", f"What does the {f['signals'][1]['label']} signal mean?", 0.35)
    if s["blocked"] and s["flagged"]:
        add("decisions", "What tips a transfer from flagged to blocked?", 0.5)

    if f["peak_hour"]:
        add("timing", f"Why is {hour_label(f['peak_hour']['hour'])} our riskiest hour?", 0.55)

    if s["fraud_prevented_ngn"]:
        add("money", "How much fraud have we prevented?", 0.6)
    if f["largest_block"]:
        add("money", "What was the largest transfer we blocked?", 0.4)

    if g["held"]:
        add("ghost", "What is held in Ghost right now?", 0.75)
    if g["cancelled"] or g["released"]:
        add("ghost", "How often do customers cancel a Ghost hold?", 0.55)
    if p:
        add("ghost", "Are our Ghost hold windows long enough?", 0.35)

    if p:
        add("policy", "Are our risk thresholds set right?", 0.5 if p.get("custom") else 0.6)
    if s["flagged"] > s["blocked"] * 4:
        add("policy", "Are we flagging too many transfers?", 0.55)

    if c["total"] and c["with_baseline"] < c["total"]:
        add("customers", f"Why do {c['total'] - c['with_baseline']} customers have no baseline yet?", 0.6)
    if c["real"] and c["with_history"] < c["real"]:
        add("customers", "Would importing more history help?", 0.45)

    if f["mode"] != "live":
        add("onboarding", "What's left before we can go live?", 0.4)
    return out


def suggest(f: dict, message: str, history: list[dict] | None, shown: list[str] | None, limit: int = 3) -> list[str]:
    """Up to `limit` follow-ups: one deeper on what was just asked, then fresh topics."""
    history = history or []
    asked_texts = [str(t.get("content", "")) for t in history if t.get("role") == "user"] + [message]
    asked = {_norm(t) for t in asked_texts}
    seen = {_norm(t) for t in (shown or [])}
    covered = {topic_of(t) for t in asked_texts} - {None}
    current = topic_of(message)

    pool = [c for c in candidates(f) if _norm(c.text) not in asked]
    fresh = [c for c in pool if _norm(c.text) not in seen]
    # Only when every fresh chip is used up does an earlier one come back.
    if len(fresh) < limit:
        fresh += [c for c in pool if c not in fresh]

    picks: list[Candidate] = []
    if current:
        near = (current, *_RELATED.get(current, ()))
        deeper = sorted((c for c in fresh if c.topic in near), key=lambda c: (near.index(c.topic), -c.weight))
        if deeper:
            picks.append(deeper[0])
    for c in sorted(fresh, key=lambda c: (c.topic in covered, -c.weight)):
        if len(picks) >= limit:
            break
        if c not in picks and all(p.topic != c.topic for p in picks):
            picks.append(c)
    for c in sorted(fresh, key=lambda c: -c.weight):
        if len(picks) >= limit:
            break
        if c not in picks:
            picks.append(c)
    return [c.text for c in picks]


def starters(f: dict, page: str | None, limit: int = 4) -> list[str]:
    """Opening questions, led by what the analyst is looking at."""
    order = _PAGE_TOPICS.get(page or "", _PAGE_TOPICS["overview"])
    pool = sorted(candidates(f), key=lambda c: (order.index(c.topic) if c.topic in order else len(order), -c.weight))
    picks: list[Candidate] = []
    for c in pool:
        if all(p.topic != c.topic for p in picks):
            picks.append(c)
        if len(picks) == limit:
            break
    for c in pool:
        if len(picks) >= limit:
            break
        if c not in picks:
            picks.append(c)
    return [c.text for c in picks]


# ── Answers without a model ──────────────────────────────────────────────────

OUT_OF_SCOPE_REPLY = (
    "That's outside what I can help with. I'm your fraud analyst: ask me about your scam patterns, "
    "channel risk, the review queue, Ghost holds or why a specific transfer was blocked."
)

_GREETING = re.compile(r"^\s*(hi|hello|hey|good (morning|afternoon|evening)|thanks?|thank you|ok(ay)?|cool|great)\b[\s!.]*$", re.I)
_AMOUNT = re.compile(r"(?:₦|ngn|n)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|thousand)?", re.I)


def _amount_in(message: str) -> float | None:
    for num, unit in _AMOUNT.findall(message):
        try:
            value = float(num.replace(",", ""))
        except ValueError:
            continue
        unit = (unit or "").lower()
        value *= 1_000 if unit in ("k", "thousand") else 1_000_000 if unit in ("m", "million") else 1
        if value >= 100:
            return value
    return None


def deterministic(message: str, f: dict) -> str:
    """A grounded answer from the figures alone, for when no model is configured."""
    if _GREETING.match(message or ""):
        if re.match(r"\s*(thanks?|thank you)", message, re.I):
            return "Any time. Ask me anything else about your fraud activity."
        return "Hello. Ask me about your scam patterns, the review queue, Ghost holds or a specific decision."

    s, w, q, g, c, p = f["summary"], f["week"], f["queue"], f["ghost"], f["customers"], f["policy"]
    topic = topic_of(message)
    if not s["transactions_analyzed"] and topic not in (None, "onboarding", "customers", "policy", "decisions", "ghost"):
        return ("There's no activity to report yet: no transfers have been scored for your institution. "
                "Import your customers and past transfers in **Settings > Data**, then try the sandbox app.")

    if topic == "recent":
        target = _amount_in(message)
        recent = f["recent"]
        pick = None
        if target:
            pick = min(recent, key=lambda r: abs(r["amount"] - target), default=None)
            if pick and abs(pick["amount"] - target) > max(target * 0.05, 1):
                pick = None
        pick = pick or next((r for r in recent if r["action"] == "BLOCK"), recent[0] if recent else None)
        if not pick:
            return "There are no flagged or blocked transfers yet."
        blocked = pick["action"] == "BLOCK"
        verb, line = ("blocked", p.get("block_threshold", "-")) if blocked else ("flagged", p.get("flag_threshold", "-"))
        sigs = ", ".join(pick["signals"]) or "no individual signals recorded"
        return (f"The **{naira(pick['amount'])}** transfer via {pick['channel'] or 'an unknown channel'} was {verb} "
                f"with a risk score of **{pick['score']}** (your {verb} line is {line}). "
                f"What fired: {sigs}. Its review state is {pick['review_state'].replace('_', ' ')}.")
    if topic == "queue":
        lead = (f"Start with the **{q['escalated']} escalated** cases, then the oldest of the {q['open']} open ones."
                if q["escalated"] else f"Start with the oldest of the **{q['open']} open** cases." if q["open"]
                else "Your queue is clear.")
        return (f"The review queue has **{q['open']} open**, {q['in_review']} in review and {q['escalated']} escalated "
                f"({q['resolved']} resolved so far). {lead}")
    if topic == "trend":
        return (f"In the last 7 days Fable scored **{w['total']}** transfers ({change(w['total'], w['prev_total'])} on the "
                f"week before). Blocks: **{w['blocked']}** ({change(w['blocked'], w['prev_blocked'])}). "
                f"Flags: **{w['flagged']}** ({change(w['flagged'], w['prev_flagged'])}).")
    if topic == "money":
        return (f"Fable has kept about **{naira(s['fraud_prevented_ngn'])}** out of fraud: transfers blocked, cancelled "
                f"by the customer, or still held in Ghost. The largest single block was {naira(f['largest_block'])}. "
                f"{s['blocked']} transfers were blocked and {s['flagged']} flagged in all.")
    if topic == "patterns":
        if not f["patterns"]:
            return "No scam-script patterns have matched on your transfers yet."
        top, rest = f["patterns"][0], f["patterns"][1:4]
        listed = ", ".join(f"{x['label']} ({x['count']})" for x in rest)
        tail = f", followed by {listed}" if rest else ""
        return (f"Your most common scam pattern is **{top['label']}** ({top['count']} hits){tail}. These are "
                "social-engineering scripts Shield recognises in Pidgin and English.")
    if topic == "channels":
        if not f["channels"]:
            return "No channel activity is recorded yet."
        riskiest = max(f["channels"], key=lambda x: x["risk_rate"])
        busiest = f["channels"][0]
        return (f"By volume **{busiest['label']}** leads ({busiest['total']} transfers). The riskiest is "
                f"**{riskiest['label']}**, with {int(riskiest['risk_rate'] * 100)}% flagged or blocked, which makes it "
                "the first candidate for step-up verification or a tighter rule.")
    if topic == "timing":
        if not f["peak_hour"]:
            return "There isn't enough risky activity yet to see a pattern by time of day."
        return (f"Risky transfers cluster at **{hour_label(f['peak_hour']['hour'])}** "
                f"({f['peak_hour']['count']} flagged or blocked). Unusual timing is one of the signals Shield weighs "
                "against each customer's own habits.")
    if topic == "ghost":
        return (f"Ghost holds a risky transfer for a cooling window ({p.get('hold_high_minutes', '-')}/"
                f"{p.get('hold_medium_minutes', '-')}/{p.get('hold_low_minutes', '-')} minutes by risk) so the customer "
                f"can cancel. Right now **{g['held']}** are held ({naira(g['held_amount'])}); customers have cancelled "
                f"{g['cancelled']} ({naira(g['cancelled_amount'])}) and released {g['released']}.")
    if topic == "policy":
        return (f"You flag at **{p.get('flag_threshold')}** and block at **{p.get('block_threshold')}** "
                f"({'your own settings' if p.get('custom') else 'Fable defaults'}). Across all time that produced "
                f"{s['blocked']} blocks and {s['flagged']} flags out of {s['transactions_analyzed']} transfers. "
                "Change them in **Settings > Risk policy**.")
    if topic == "customers":
        return (f"You have **{c['total']}** customers ({c['real']} real, {c['test']} test). {c['with_baseline']} have a "
                f"baseline and {c['with_history']} have any history. Importing past transfers in **Settings > Data** "
                "gives the rest a baseline from day one.")
    if topic == "onboarding":
        return ("Going live needs: the data processing agreement and DPIA confirmed, an API key, a tested webhook, "
                "your risk thresholds reviewed, and your real customers imported. Track it in **Settings > Go live**.")
    if topic == "decisions":
        sig = f["signals"][0]["label"] if f["signals"] else None
        return (f"Shield scores every transfer against the customer's own baseline. At **{p.get('flag_threshold')}** it "
                f"asks the customer to verify; at **{p.get('block_threshold')}** it blocks. "
                + (f"On your risky transfers the most common signal is **{sig}**. " if sig else "")
                + "Every decision records the exact signals that fired.")
    return OUT_OF_SCOPE_REPLY
