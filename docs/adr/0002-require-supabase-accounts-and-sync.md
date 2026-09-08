# Require Supabase accounts and synchronized product data

Kineo now requires an Account and uses Supabase Auth plus private PostgreSQL data behind authenticated Edge Functions. This deliberately replaces the earlier account-free, fully offline architecture so history can follow an adult across installations; initial authentication and new Plan creation require connectivity, while cached history and an active Routine remain locally usable. The trade-off is a larger privacy, security, availability, and App Review surface, accepted in exchange for durable account functionality.

