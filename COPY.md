# Copy Style Guide

How Ledger speaks in every user-facing string: UI, help text, empty states,
toasts, notifications, README, and docs. `.impeccable.md` governs the visual
design; this file governs the words.

## Voice

Plain, direct, conventional. Write like a knowledgeable person explaining the
app to a friend, in as few words as the meaning allows.

- Second person ("you"), present tense, active voice.
- One idea per sentence. If a sentence needs a second clause, it usually
  deserves a second sentence.
- Concrete over abstract. Name the button, the field, the number.
- Say the thing, then stop. No closing flourish, no summarizing coda.

## Hard rules

These patterns read as machine-written. None of them appear in shipped copy.

1. **No em dashes.** Use a period, a comma, a colon, or restructure the
   sentence. Zero tolerance in user-facing text; comments in code may keep
   them where they aid readability, but prefer the same discipline.
2. **No contrast framing.** Rewrite "not X, but Y", "X, never Y", "X rather
   than Y", and "X instead of Y" as the positive statement alone. If the
   negative matters, give it its own plain sentence.
   - Before: "A misheard number is one you can see and fix rather than one
     the app invented."
   - After: "You can see and correct a misheard number before saving."
3. **No rule-of-three lists in prose.** Two examples are enough to make a
   point; more than that belongs in a real list.
4. **No metaphors or scene-setting.** Delete "a gentle guard against impulse
   buys", "a clean page", "with a clearer head". Describe the behavior.
5. **No marketing filler.** Banned words include: seamlessly, effortlessly,
   simply, elevate, reimagine, empower, unlock, "It's not just X", "Whether
   you're X or Y".
6. **American spelling.** Recognize, color, anonymized, totaled.

## Formatting

- Bold UI labels the reader needs to find on screen (**Log it**,
  **Settings → Members**). Bold nothing else.
- Italic only for example input the user would type or say.
- Keep helper text under two sentences where possible. Help-center entries
  may run longer, one topic per paragraph.

## Checking copy

Run this from the repo root before merging copy changes:

```sh
grep -rn '—' src static README.md .env.example compose.yaml
grep -rniE 'not (just |only |merely )?.+, but|never an?|rather than|seamlessly|effortlessly|reimagine' \
  src static README.md
```

Both should return nothing in user-facing strings. Treat any hit in a string
the user sees as a bug.
