# @hipo/audit

Audit log: a single `audit_log` table + `writeAudit()` helper that mutating
`do_*` operations call inside their transaction.

## Public surface

```ts
import {
  writeAudit,
  doListAuditLog,
  auditLog,
  type AuditEntryRow,
  type AuditEntry,
  type ListAuditLogInput,
  type Tx,
} from "@hipo/audit";
```

For deep imports:

```ts
import { auditLog } from "@hipo/audit/schema";
```

## Convention

Every mutating `do_*` opens a transaction and calls `writeAudit` inside it
before committing. Action strings are `entity.verb` (`party.create`,
`loan.update`, `payment.delete`). Payload is `{before, after}` JSON.

```ts
await ctx.db.transaction(async (tx) => {
  // ...mutate...
  await writeAudit(tx, userId, "party.create", "party", partyId, {
    before: null,
    after: createdRow,
  });
});
```
