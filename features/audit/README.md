# Audit

Admin action logging (who did what, sanitized before storage).

**Backend:** `auditService.js` (no routes — imported directly by other modules)

## Depends on
- `shared/backend-core`: `db.js`

## Depended on by
`auth`, `courses` (via admin actions), `meetings`, `upload`, `admin-shell`
