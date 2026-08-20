# Demo reel script

A script for a screen recording of Ledger, written to land at about **2:45**.
Three minutes is the ceiling; anything past that and people stop watching before
the good part.

## Before you record

Record the phone, not a browser window. A real device or a phone-shaped viewport
both work, but the app is designed at 393 points wide and looks wrong stretched.

Use the demo at [ledger.pvi.sh](https://ledger.pvi.sh) or a local
`bun run demo:build` and serve `build-demo/`. Both have the seeded household in
them, so the figures are invented and nothing needs redacting. Hide the demo
banner if you record the hosted one.

Two things to check before you hit record: the Safe to Spend figure is set to
**Always shown** in Settings then Harmony, or the hero number will be dots; and
you are signed in as Charlie, who owns the workspace and has nothing hidden from
them.

Narration is written to be read at an unhurried pace. Where a line runs shorter
than its slot, let the screen breathe instead of filling the gap.

---

## 0:00 to 0:15 · the ledger

**Screen:** open on `/purchases`, already scrolled to the top.

> This is Ledger. It is a budget for a household, for the people you actually
> share money with, and it runs on your own server.

**Action:** hold still for a beat, then let the eye settle on the number at the
top.

> The number at the top is what is free to spend for the rest of the month.

---

## 0:15 to 0:40 · Safe to Spend

**Action:** tap the Safe to Spend card. The breakdown expands.

> It is not a guess. Tap it and you get the whole calculation.

**Action:** let the lines sit on screen. Do not scroll yet.

> Income, then everything already spent, everything approved but not yet paid
> for, the bills still due, and whatever moved into savings.

**Action:** scroll down slowly to reveal "The months after".

> Underneath, the next few months, projected from whatever repeats. No language
> model touches any of this. It is arithmetic over rows you can go and look at.

---

## 0:40 to 1:00 · logging a purchase

**Screen:** the new purchase form.

> Recording something you bought takes a few seconds.

**Action:** type an amount, an item, a merchant. Type at a normal speed; do not
paste.

> Amount, what it was, who you paid.

**Action:** rest on the two buttons at the bottom without pressing either.

> Log it if you already bought it. Ask first if you have not.

---

## 1:00 to 1:30 · the approval loop

**Screen:** back on the ledger, with the waiting requests at the top.

> Anything waiting on a decision sits at the top of everyone's ledger.

**Action:** tap into a pending purchase. Let the detail screen land.

> Open one and the amount is the whole screen. This is the part the app is built
> around, so it is one gesture and no form to fill in.

**Action:** tap Approve. Let the state chip flip and the history line appear.

> Approve, and it is done.

**Action:** scroll to the history section.

> Every decision goes into an audit log that nobody can edit afterwards.

Optional, if you have the time: mention that overspending an approved amount
sends the purchase back for another decision.

---

## 1:30 to 1:55 · planning

**Screen:** Buckets.

> Buckets put money aside on a schedule. Each one has an owner and something it
> is saving toward.

**Action:** switch to Recurring.

> Bills that arrive on their own, totalled by month and by year.

**Action:** switch to Income.

> Income repeats too, with everything already received folded away underneath.

---

## 1:55 to 2:20 · where it went

**Screen:** Activity.

> Every figure here is worked out live, and filtered for whoever is looking.

**Action:** scroll through the category and member breakdowns.

> Spending by category, by person, by week.

**Action:** keep scrolling to Settle up.

> And if you split things, Settle up works out who owes whom, and the payments
> that even it out.

---

## 2:20 to 2:35 · the statement

**Screen:** the monthly statement.

> At the end of the month the whole thing gets read back to you in plain
> language.

**Action:** scroll far enough to show Harmony's read.

> Same rule as before. That paragraph is generated from your own totals, not by
> a model guessing.

---

## 2:35 to 2:45 · close

**Action:** Settings then Appearance. Switch the theme, tap a different accent.

> Light or dark, ten accents, one per workspace.

**Action:** back to the ledger, and hold.

> Self-hosted, free, and open source. Your server, your database, your money.

---

## Lines to avoid

Worth saying out loud once before recording. This is a budgeting app for
households, and overclaiming is the fastest way to lose the people who would
actually run it.

- Do not call anything AI powered. The assist is optional, off by default, and
  cannot decide anything on its own. Saying otherwise misrepresents the app and
  the README will contradict you.
- Do not promise bank sync. Reconciliation is a file you import by hand.
- Do not imply the hosted demo stores anything. It runs entirely in the tab.

## If you need a shorter cut

A 60 second version that still makes sense: the ledger and Safe to Spend
(0:00 to 0:25), the approval loop (0:25 to 0:45), the statement (0:45 to 0:55),
and the close. Drop planning and Activity; they are the parts people go looking
for once they already want the app.
