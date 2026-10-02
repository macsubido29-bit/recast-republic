# Self-hosted store database

This setup runs the store on your own Node.js server and PostgreSQL database; it does not use Supabase or another hosted database partner. The site stores information submitted by registered buyers: account name/email, profile and delivery details, orders, and support messages. It does not collect anonymous browsing history, search terms, IP-based visitor profiles, or analytics. Passwords are stored as salted hashes; session tokens are stored hashed and sent to browsers only in HttpOnly cookies.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- A server/hosting plan that supports a continuously running Node.js app
- HTTPS for a public production site

## Start the app

1. Create a PostgreSQL database and a database user with permission to create tables and indexes in the app database.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the PostgreSQL connection string. Keep `.env` private and out of source control.
3. Install dependencies with `npm install`, then start with `npm start`.
4. Point your HTTPS reverse proxy/domain to the Node app's port. If HTTPS is terminated at a trusted reverse proxy, set `TRUST_PROXY=true`.

At startup the server creates the tables in `db/schema.sql` and inserts the eight original products only when the shared catalog is empty. Open the app through the server URL; opening `index.html` directly as a `file:` URL bypasses the backend.

## Authorize seller and admin accounts

Visitors can register as buyers. A database administrator must explicitly promote an account after verifying its owner:

```sql
update app_users set role = 'seller' where email = 'seller@example.com';
update app_users set role = 'admin' where email = 'recastrepublic29@gmail.com';
```

Use the admin email address only for the trusted administrator account. Never let visitors choose their own roles. The admin can download the submitted visitor/account data export from Seller Center.

## Admin email alerts (optional)

To send order and status notifications to `recastrepublic29@gmail.com`, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in the server's private environment. Email delivery uses that SMTP account; it is not needed for database storage. If SMTP is not configured, orders still save and the app tells the user that the email was not sent.

## Data and backups

The database is the source of truth across devices. It stores registered account details, optional profile and delivery information, product listings, order snapshots/status, notifications, and buyer/seller support messages. Cart contents remain in the visitor's browser until checkout. Anonymous visitors are not individually identified or recorded.

Back up PostgreSQL regularly using your hosting provider's backup facility or `pg_dump`, and protect the backup because it contains personal and delivery information. Only the buyer and authorized sellers/admins can access order/message records through the app; admin export is restricted to the `admin` role. Do not publish database credentials, `.env`, password hashes, or session records.

## Existing browser-only data

Old accounts, orders, messages, and custom products from `localStorage` are not automatically migrated. The shared database starts with the built-in products. Keep the old browser data until you have manually transferred anything you need.
