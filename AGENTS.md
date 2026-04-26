# Store-POS Project Rules

## Critical POS Safety Rules

This is a real shop POS system. Any change can affect money, stock, customer balances, supplier balances, and daily closing.

Before changing any code, always identify whether the change affects:

- Sales total
- Discount
- Tax
- Cash/card/credit payment
- Customer ledger
- Supplier ledger
- Stock quantity
- Purchase cost
- Profit calculation
- Refill sale total
- Daily closing
- Reports
- Refund/return flow

For every such change, you must:

1. Trace the full transaction flow from UI to database.
2. Confirm what tables/fields are written.
3. Confirm stock deduction logic.
4. Confirm customer/supplier balance update logic.
5. Confirm daily closing/report impact.
6. Add or update tests for calculation and database saving.
7. Test with sample cases before marking complete.
8. Never change calculation logic silently.
9. Never overwrite old financial records.
10. Never delete transaction history.
11. Use adjustment/reversal records instead of editing past sales.
12. Keep audit trail: who changed what, when, and why.
13. Use database transaction/rollback for sale, refund, purchase, payment, and stock updates.
14. If one step fails, whole operation must fail safely.
15. After any change, run a POS safety checklist and show results.

## Required Test Cases

- Cash sale
- Card sale
- Credit sale
- Mixed payment if supported
- Discount sale
- Refill sale by amount
- Product variant sale
- Stock receiving with new cost
- Customer payment received
- Supplier payment
- Return/refund
- Daily closing
- Low stock update
- Profit report
- Customer ledger report

## Important Rules

- Money calculations must use integer cents/paisa or decimal-safe logic, not floating point.
- All invoices must have unique invoice numbers.
- All records must be saved before printing receipt.
- Reports must be calculated from saved transactions, not temporary UI values.
