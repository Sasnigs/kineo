# Kineo Domain Language

Kineo is an account-based movement-planning product for adults managing recurring, non-acute neck or back discomfort. These terms keep product, client, server, and tests aligned.

## Account and access

**Account**:
The single adult identity that owns Kineo preferences and wellness history.
_Avoid_: User profile, customer

**Installation**:
One registered app installation authorized to synchronize an Account, identified independently from authentication credentials.
_Avoid_: Device, session

**Session**:
A renewable authenticated relationship between an Account and Kineo.
_Avoid_: Login, Installation

**Legal Acceptance**:
An immutable record that an Account accepted one exact legal document version and locale.
_Avoid_: Consent, checkbox

## Movement planning

**Check-in**:
One immutable attempt to report the current state of one primary and optional secondary Body Area before requesting a Plan.
_Avoid_: Survey, assessment

**Plan**:
The server-authoritative selection and composition decision produced from a committed Check-in and versioned Kineo rules and content.
_Avoid_: Recommendation, prescription

**Routine**:
The immutable authored movement sequence created from one Plan.
_Avoid_: Workout, treatment

**Attention Required**:
An unresolved area-specific safety state that prevents every new Plan until the documented return or correction flow clears it.
_Avoid_: Alert, diagnosis

## Synchronization and privacy

**Mutation**:
One typed, idempotent request to change Account-owned state.
_Avoid_: Update, row write

**Change Cursor**:
An opaque position in an Account's ordered cloud change feed.
_Avoid_: Timestamp, offset

**History Epoch**:
The Account generation that invalidates history Mutations created before the latest Reset History.
_Avoid_: Schema version, reset counter

**Reset History**:
The Account-wide removal of wellness history while retaining the Account, settings, legal records, and the minimum active Attention Required state.
_Avoid_: Delete Account, clear cache

**Delete Account**:
The verified irreversible workflow that revokes access before removing Account-owned domain and authentication data.
_Avoid_: Logout, Delete All

