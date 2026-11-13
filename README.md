# Warehouse Material MMP

Next.js warehouse application. Supabase Auth and the Supabase database are used by the current app; `app-legacy/`, `index.html`, `app.js`, and `server.js` are an older standalone preview and are not the deployed Next.js application.

## Run locally

```powershell
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in an ignored `.env.local` file. Never put a Supabase service-role/secret key in a `NEXT_PUBLIC_*` variable or in Git.

## Supabase setup and security

For a new database, run `supabase-schema.sql`, then run `supabase-security-hardening.sql` in the Supabase SQL Editor. For an existing database created from the earlier schema, run only `supabase-security-hardening.sql`. Resolve any case-insensitive duplicate part numbers if the migration reports them.

## Delivery workflow setup

After the warehouse schema and hardening migration are installed, run `supabase-delivery-schema.sql`, then `supabase-delivery-security.sql`. The latter closes the original broad delivery table policies and installs client scoped reads plus token checked driver functions. A delivery is marked received by the client portal or warehouse operator; the database deducts loaded quantities and writes transaction rows as one atomic operation at that point. Arrival at the client site does not reduce stock.

Create a client login under Supabase Authentication, then copy that Auth user's UUID into the client's **ID User Auth** field in the warehouse Clients page. The client can then sign in at `/client` and view only its own delivery orders. Client Auth accounts must be created in Supabase Auth; this app intentionally does not expose a service role key in the browser.

The driver link uses its token as a bearer credential. Share it only with the assigned driver. The driver can mark departure, arrival, and return; tracking requests GPS permission while the order is in transit. The driver page displays the destination company name and asks the driver to mark arrival before entering a site where phones are prohibited.

The migration restricts material administration to `admin@mmp.local`, allows authenticated warehouse users to read, and routes stock changes through atomic database functions that also write the transaction log. Create only the intended admin and operator accounts in Supabase Auth, disable public sign-ups, and change any demo passwords before using real inventory.

The client uses the publishable/anon key. RLS is the security boundary; the UI role check is only for presentation. Do not deploy until the hardening SQL has been applied successfully and tested in Supabase.

## Current read limits

The app requests the latest 500 transactions. Material queries use the Supabase API row cap (default 1,000 unless changed in project settings), so larger inventories need server-side pagination. Material photos are limited to 1 MB each and stored as data URLs in the database; use Supabase Storage before storing many photos.

## Legacy HTML preview

`node server.js` runs the old standalone preview, usually on port 4173. Changes to the Next.js app are under `src/` and do not appear in that preview.
