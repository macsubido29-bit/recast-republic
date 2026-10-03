# Self-hosting Recast Republic

The store serves `index.html` and its API from one Node.js process. Account,
profile, address, product, order, notification, and support-message data is kept
in a local SQLite database on the server. Anonymous catalog visitors are not
assigned accounts or recorded. Signed-in shopping carts are saved to the server
per account and are available when that account signs in from another device.
Checkout revalidates prices and availability on the server.

## Requirements and startup

- Node.js 22 or newer
- Persistent disk storage on the host

Install dependencies and start the store:

```sh
npm install
npm start
```

Open `http://localhost:3000` (or the deployed server URL), not `index.html` as a
`file://` page. SQLite is created automatically at `data/recast-republic.sqlite`
the first time the server starts, and the original collectibles are inserted if
the catalog is empty. Keep the `data` directory on persistent storage and include
it in secure backups. `DB_PATH` in `.env` can point to another persistent file. The database file is
excluded from Git.

In production, serve the app over HTTPS. Optional SMTP settings in `.env.example`
send new-order, order-update, seller-application, and support-message alerts to
`ADMIN_EMAIL` (`recastrepublic29@gmail.com` by default). For Gmail, the defaults
are `smtp.gmail.com`, port `587`, and
`SMTP_SECURE=false`. Set `SMTP_USER` to the sending Gmail address and
`SMTP_PASSWORD` to a Google App Password. The optional `SMTP_FROM` defaults to
`SMTP_USER`. Do not use your normal Gmail password. Remove spaces from the App
Password when putting it in the environment file, and do not paste it into chat
or commit it.
On the server, set these values in `/etc/recast-republic/store.env`; locally, use
the ignored `.env` file. Restart the Node service after changing settings.
Admins can check readiness and send a test message from Seller Center → Admin
tools. New seller applications also email the configured admin for review;
approval or rejection still requires an authenticated admin in Seller Center.
Missing settings or delivery errors are also logged by the server.
Records continue to be saved if SMTP is unset.

## Deploy to the Ubuntu 24.04 VPS

The VPS provider's machine name (currently `recast-republic`) is not necessarily
a public DNS name. Before enabling HTTPS, obtain its public IP from the provider
and confirm `recast-republic-29.ph` resolves to it. It currently resolves to
`45.79.222.138`. Open ports 22, 80, and 443 in the provider firewall; keep port
3000 private. The GitHub Pages frontend can stay at the `github.io` address.
For browsers that block third-party cookies, use a frontend and API under the
same registrable domain.

From PowerShell on the computer containing this project, substitute the SSH
username and VPS IP, then copy the app source to the VPS. SSH port 22 was not
reachable during the connection check, so enable SSH in the provider firewall
or use the provider's web console. Do not copy `.env`, `node_modules`, or a
local database:

```powershell
ssh user@45.79.222.138 "mkdir -p /tmp/recast-republic"
scp -r index.html api-config.js server.js package.json package-lock.json db deploy user@45.79.222.138:/tmp/recast-republic/
```

Connect by SSH, then install Node.js 22, Nginx, and the required system tools:

```sh
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx sqlite3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

Continue in the SSH session to install the app and create its private persistent
database directory:

```sh
sudo useradd --system --home-dir /opt/recast-republic --create-home --shell /usr/sbin/nologin recast-republic
sudo install -d -o root -g recast-republic -m 0750 /opt/recast-republic/app
sudo cp -a /tmp/recast-republic/. /opt/recast-republic/app/
sudo chown -R root:recast-republic /opt/recast-republic/app
sudo chmod -R o-rwx /opt/recast-republic/app
sudo install -d -o recast-republic -g recast-republic -m 0750 /var/lib/recast-republic
sudo install -d -o root -g root -m 0750 /etc/recast-republic
sudo npm ci --omit=dev --prefix /opt/recast-republic/app
```

Create `/etc/recast-republic/store.env` with `sudo nano` and set:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DB_PATH=/var/lib/recast-republic/store.sqlite
TRUST_PROXY=true
ADMIN_EMAIL=recastrepublic29@gmail.com
```

Add SMTP settings there only if admin email alerts are desired. Restrict the
file, install the service, and start it:

```sh
sudo chown root:recast-republic /etc/recast-republic/store.env
sudo chmod 0640 /etc/recast-republic/store.env
sudo install -m 0644 /opt/recast-republic/app/deploy/recast-republic.service /etc/systemd/system/recast-republic.service
sudo systemctl daemon-reload
sudo systemctl enable --now recast-republic
sudo systemctl status recast-republic --no-pager
curl http://127.0.0.1:3000/api/health
```

After `recast-republic-29.ph` points at the VPS, install the supplied Nginx
config and enable HTTPS:

```sh
sudo install -m 0644 /opt/recast-republic/app/deploy/nginx.conf /etc/nginx/sites-available/recast-republic
sudo ln -s /etc/nginx/sites-available/recast-republic /etc/nginx/sites-enabled/recast-republic
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d recast-republic-29.ph
```

Set `WEBSITE_URL` in `/etc/recast-republic/store.env` to the frontend URL, for
example `https://macsubido29-bit.github.io`, then restart the service. Optional
additional origins can be listed in `CORS_ORIGINS`. The static site's
`api-config.js` is configured to call
`https://recast-republic-29.ph`. GitHub Pages cannot run the Node.js/SQLite
backend; it hosts only the storefront files. A browser connection is expected
to fail until the API is deployed and the HTTPS certificate is installed.

`ADMIN_KEY` is not used by this application. Admin privileges are assigned to
accounts through the local SQLite database; do not assume setting an environment
variable will create or authorize an admin account.

To update the app later, upload the changed source files, copy them into
`/opt/recast-republic/app`, rerun `npm ci --omit=dev --prefix
/opt/recast-republic/app` when dependencies change, and restart with
`sudo systemctl restart recast-republic`. Back up
`/var/lib/recast-republic/store.sqlite` securely and test restoring backups.

## Seller applications and admin access

New accounts are buyers by default. They can select Seller Login or submit a
seller application during registration or later from Settings. Applications
remain pending until an admin reviews them under Seller Center; approval grants
the seller role, and rejection leaves the account as a buyer.

To bootstrap the first admin, create an account and set its role in SQLite.
Register the account matching `ADMIN_EMAIL` first, then run this local command
from the app directory (using the configured database path):

```sh
npm run admin:promote -- recastrepublic29@gmail.com
```

The command only promotes the email configured by `ADMIN_EMAIL`; on the VPS,
run it after registering that account and while `DB_PATH` points to the
production database. Sign out and back in so the store reloads the role. Admins
can review seller applications, restore the original catalog, and download a
JSON export of accounts (excluding passwords), profiles, carts, products,
orders, seller applications, messages, and notifications. Use the SQLite
database itself for a full backup. Protect the database, backups, and downloaded
exports as sensitive personal data.
