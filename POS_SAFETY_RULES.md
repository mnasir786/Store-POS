# CRITICAL POS SAFETY RULES

This is a real shop POS system. Any change can affect money, stock, customer balances, supplier balances, and daily closing.

## CORE DIRECTIVES
1. **Never change calculation logic silently.**
2. **Never overwrite old financial records.**
3. **Never delete transaction history.**
4. **Use adjustment/reversal records** instead of editing past sales.
5. **Keep an audit trail**: who changed what, when, and why.
6. **Use database transaction/rollback** for sale, refund, purchase, payment, and stock updates.
7. **If one step fails, the whole operation must fail safely.**
8. **All records must be saved** before printing a receipt.
9. **Reports must be calculated from saved transactions**, not temporary UI values.

## IMPACT ANALYSIS
Before changing any code, always identify whether the change affects:
- Sales total / Discount / Tax
- Cash/card/credit payment flow
- Customer / Supplier ledger
- Stock quantity / Purchase cost
- Profit calculation
- Daily closing / Reports
- Refund/return flow

## VERIFICATION WORKFLOW
For every such change, you must:
1. Trace the full transaction flow from UI to database.
2. Confirm what tables/fields are written.
3. Confirm stock deduction logic.
4. Confirm balance update logic (Customer/Supplier).
5. Confirm daily closing/report impact.
6. Run a POS safety checklist and show results.

## REQUIRED TEST CASES
- Cash/Card/Credit sales
- Discount & Refill sales
- Stock receiving (with new cost tracking)
- Customer & Supplier payments
- Return/Refund processing
- Daily closing & Profit reports
- Customer ledger accuracy

## TECHNICAL REQUIREMENTS
- **Money calculations** must use decimal-safe logic (no floating point errors).
- **Unique Invoice Numbers** must be strictly enforced.
