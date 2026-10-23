# ADR 0004: Cost prices, period reports, and sale reversals

- Status: Accepted by the product owner
- Date: 2026-10-22
- Amends: ADR 0003 (refunds were out of scope for that milestone)

The Sales tab is replaced by a Menu button that opens a dock menu with Sales
history, Reports and Users. Users is a placeholder: staff accounts and
authentication are deferred, so every action is still taken as the device.

Each size may carry an optional cost price in integer cents. Checkout copies it
onto the receipt line (`sale_items.unit_cost_cents`) next to the selling price,
so later edits never change past profit. Lines without a cost are reported as
"cost not set" and left out of profit and margin rather than estimated.

A cashier can reverse all or part of a sale made the same local calendar day,
with a required reason. Sales are never edited: a reversal is its own record
(`sale_reversals`, `sale_reversal_items`) with the cash refunded and, per line,
whether the units went back to stock or were written off. Repeating a reversal
reference never refunds twice. The dashboard's takings for today are net of
refunds.

Reports use local calendar periods (today, Monday–Sunday week, month, quarter)
compared with the previous period. Profit is net revenue on costed lines, less
their cost, less the cost of returns that were written off. Losses are sizes
sold below cost and written-off returns. All figures come from receipts and
reversals, so they are reproducible.
