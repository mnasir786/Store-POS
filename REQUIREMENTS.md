# Store-POS: Final Product Requirements (Vape Store Edition)

## 1. Core Objective
To provide a high-performance, secure, aesthetically premium, and **Offline-Ready Windows POS** tailored for Vape/Refill shops. Ensuring 100% financial accuracy, fast retail workflow, and zero internet dependency.

---

## 2. Product Hierarchy & Categories
### A. Top-Level Categories
1. **Hardware**: 
   - Sub-categories: Devices, Coils.
   - Fields: Brand, Model, SKU/Barcode, **Unit Cost Price**, Sale Price, Stock, Min Stock Alert.
2. **Liquid**:
   - Fields: Brand, Flavor, Bottle Size (30ml, 60ml, 100ml), Nicotine (6mg, 25mg, 30mg, 50mg), **Unit Cost Price**, Sale Price, Stock.
   - Note: Barcode optional; needs easy admin handling for high flavor counts.
3. **Refill (Special Module)**:
   - High-speed workflow for staff.
   - Shortcut Buttons: 200, 400, 600, and Custom Amount.

---

## 3. Functional Requirements

### A. Sales & Checkout (Phase 1 Priority)
- [ ] **Refill Quick-Sale**: Minimal clicks; track refill revenue separately in daily totals.
- [ ] **Multi-Payment**: Cash, Card, and "On Account" (Credit).
- [ ] **Invoice Integrity**: Unique invoice numbers; save-to-DB before print.
- [ ] **Hardware Tracking**: Record Serial Numbers for mods/hardware (Warranty support).

### B. Purchase & Stock Receiving (E)
- [ ] **Supplier Selection**: Track which supplier provided each batch.
- [ ] **Batch Costing**: Support for changing **Unit Cost Prices** per batch while keeping reporting stable.
- [ ] **Receiving History**: Preserve a log of every stock arrival including **Cost Price per Unit**.

### C. Customer Ledger & Credit (F)
- [ ] **Profiles & Statements**: Track who owes money, how much, and their full account history.
- [ ] **Payment Recording**: Ability to receive payments later and clear outstanding balances.

### D. Reporting & Closing (G)
- [ ] **Daily Z-Report**: Total sales, Category splits (Hardware/Liquid/Refill/Credit), Cash/Card split, Best sellers.
- [ ] **Profit Estimate**: Real-time calculation based on batch costs and expenses.

### E. User Roles & Security (H)
- [ ] **Admin**: Full system access, settings, and financial history.
- [ ] **Cashier**: Restricted to sales, refill entry, and limited customer actions. No admin/settings access.

---

## 4. Technical & Safety Requirements

### A. POS Safety Rules (Critical)
- [ ] **Decimal-Safe Math**: No floating-point errors in money/stock.
- [ ] **Atomic Transactions**: If sale/stock update fails, whole operation rollbacks.
- [ ] **No Deletion**: Use reversals/adjustments instead of deleting records. Audit trail: Who, What, When, Why.

### B. Offline & Windows Optimization (I)
- [ ] **Local-First**: 100% offline operation via local database (NeDB).
- [ ] **Performance**: Fast startup and lag-free sales screen.
- [ ] **Maintenance**: Auto daily backups and simple "Easy Install" packaging for Windows.

---

## 5. UI/UX Standards (Phase 3)
- [ ] **Modern Sidebar & Dashboard**: SaaS-style clean layout.
- [ ] **Practical Desktop-First**: Optimized for mouse/keyboard retail workflow.
- [ ] **Minimal Clicks**: Cashier tasks must be achievable with minimal interaction.
- [ ] **Premium Aesthetics**: Modern typography, clean forms, and polished tables.

---

## 6. Implementation Roadmap
1. **Module: Stock Receiving & Suppliers** (Enables accurate profit).
2. **Module: Refill Shortcuts & Categories** (Hardware/Liquid/Refill split).
3. **Module: User Permissions** (Admin vs. Cashier logic).
4. **Module: Reports & Expenses** (The Final Profit Dashboard).
5. **Module: Packaging & Backups** (Windows Ready).
