# Fable: positioning and sandbox demo walkthrough

A short narrative and a six-minute walkthrough of the platform as it is built: the sandbox banking app and the institution console. Screen names and button labels below are the ones in the product. Update this file whenever those screens change.

---

## The narrative (about 3 minutes)

**The problem.** Someone gets a call from a person who sounds exactly like their mother. There's an emergency, and money is needed now. They open their banking app, enter the correct PIN, confirm the OTP and authorise the transfer themselves. To the bank, everything looks normal. But they're being scammed.

**The gap.** Traditional security confirms that you're the person making a transaction. That doesn't mean you're making the right decision. Fable goes further: it understands each customer's normal transaction behaviour and notices when something doesn't add up.

**Three agents.**

- **Copilot** learns each customer's habits: regular recipients, amounts, timing and channels.
- **Shield** scores every transfer in real time, using behavioural anomaly detection and contextual risk signals, and explains why a transfer looks unusual.
- **Ghost** handles the moment a customer sees a warning and still proceeds under pressure. It puts a short, cancellable cooling window on high-risk transfers.

Copilot understands, Shield detects, Ghost contains.

**How it's built.** Machine learning (an Isolation Forest per customer), deterministic risk rules for the decision, and generative AI only for the plain-language explanation. The LLM never decides whether money moves.

**How it fits.** Fable doesn't replace a bank's infrastructure. The bank's server calls one API before a transfer moves, acts on the verdict, and receives signed webhooks. Fable uses only the behavioural and contextual signals it needs.

**Why it matters in Africa.** Social engineering, impersonation and authorised payment scams are the main way money is lost. Fable responds to them without making every legitimate transfer stressful.

**Business model.** B2B. Banks and fintechs integrate through the API and pay a recurring licence based on transaction volume and usage. The value is fewer fraud losses, lower operating cost and better customer protection.

---

## Before you start

- Sign in to the bank's **console**. In another tab, open the **sandbox app** from the console sidebar ("Open the demo bank").
- Pick the customer in the sandbox header, where their name sits beside the bell. Choose one whose history makes a large transfer unusual. The **"What Fable checks on this transfer"** panel on the Transfer screen shows the live device, location, session and behaviour signals.
- Decide your two transfers in advance: one ordinary, one risky.

## The walkthrough (about 3 minutes)

| Time | On screen (as built) | What to say |
|---|---|---|
| 0:00–0:25 | Sandbox **Dashboard**: the customer's balance, recent transactions, and "How you usually bank". | This is the sandbox: a test banking app for a provisioned bank. The same engine sits behind a real bank's app through our API. |
| 0:25–0:55 | **Transfer**: pick a saved contact such as Mum, enter an amount in their normal range, and send. The **Transfer sent** receipt appears with a low risk score. | A normal transfer: someone this customer pays often, for an amount that fits their history. Fable recognises it and lets it straight through, no extra steps. |
| 0:55–1:40 | **Transfer** again: choose **Unknown** (a new account), enter a much larger amount, and type the narration "urgent help abeg". Shield answers with **Transfer paused** (a block) or **Please confirm this transfer** (a flag). Show the risk score, **What Shield noticed**, and the written reasons. | Same customer, a much larger amount, to an account they've never paid, with urgency in the note. Shield compares it with their normal behaviour and says exactly why it's unusual. It's a reason, not just a score. |
| 1:40–2:15 | On a block, tap **Send anyway, with protection**. This opens **Funds on hold**, with the **Cooling window** countdown, **Cancel and get my money back**, and **I'm sure, release the transfer** (which needs the transaction PIN). On a flag, **Send anyway, verify it's me** asks for a PIN, passkey or code instead. | When a customer insists, often with a scammer on the phone, Ghost holds the transfer for a short cooling window so they can stop and get the money back. In the sandbox this runs on a simulated ledger. In production the bank holds the transfer in its own flow, before it reaches the payment rail. Fable never holds the money. |
| 2:15–2:45 | **Console**: the **Overview** tiles, then the **Review queue**. Open the case to show the signals, explanation and customer history, then **Assign to me**, add a note, and **Confirm fraud** or **Mark legitimate**. Finish on **Compliance** to show the audit trail. | On the bank's side, every decision is visible to the fraud team: reasons, a review queue, analyst actions and an audit trail. Each bank's data is isolated from every other bank's. |
| 2:45–3:00 | Stay on the console. | We don't only want banks to know who is making a transaction. We want them to know when it doesn't make sense, and act before it's too late. |

## Checklist

- Keep the sandbox app and the console open in separate tabs, signed in.
- Run both transfers once beforehand, so you know which screen the risky one produces for that customer.
- Rehearse with a timer.
- Show only what works in the current build.
