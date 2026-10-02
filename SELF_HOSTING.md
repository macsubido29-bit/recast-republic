# Self-hosting Recast Republic

The store serves `index.html` and its API from one Node.js process. Account,
profile, address, product, order, notification, and support-message data is kept
in a local SQLite database on the server. Anonymous catalog visitors are not
assigned accounts or recorded. A signed-in cart stays in that browser until
checkout; checkout revalidates prices and availability on the server.

## Requirements and startup

- Node.js 20 or newer
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
it in secure backups. `DB_PATH` in `.env` can point to another persistent file.
The database file is excluded from Git.

In production, serve the app over HTTPS. Optional SMTP settings in `.env.example`
send new-order, order-update, and support-message alerts to `ADMIN_EMAIL`
(`recastrepublic29@gmail.com` by default). For Gmail, use `smtp.gmail.com`, port
`587`, `SMTP_SECURE=false`, your Gmail address as `SMTP_USER` and `SMTP_FROM`,
and a Google App Password as `SMTP_PASSWORD`. Do not use your normal Gmail
password. Records continue to be saved if SMTP is unset.

## Deploy to the Ubuntu 24.04 VPS

The VPS provider's machine name (currently `recast-republic`) is not necessarily
a public DNS name. Before enabling HTTPS, obtain its public IP from the provider
and create an `A` record for `api.recastrepublic.com` pointing to that IP. Open
ports 22, 80, and 443 in the provider firewall; keep port 3000 private. The
GitHub Pages frontend can stay at the `github.io` address. For browsers that
block third-party cookies, configure `www.recastrepublic.com` as the GitHub
Pages custom domain and use that same-site frontend for account sign-in.

From PowerShell on the computer containing this project, substitute the SSH
username and VPS IP, then copy the app source to the VPS. Do not copy `.env`,
`node_modules`, or a local database:

```powershell
ssh user@VPS_PUBLIC_IP "mkdir -p /tmp/recast-republic"
scp -r index.html server.js package.json package-lock.json db deploy user@VPS_PUBLIC_IP:/tmp/recast-republic/
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

After the `api.recastrepublic.com` DNS record points to the VPS, install the
supplied Nginx config and enable HTTPS for the API hostname:

```sh
sudo sed 's/YOUR_DOMAIN/recastrepublic.com/g' /opt/recast-republic/app/deploy/nginx.conf | sudo tee /etc/nginx/sites-available/recast-republic
sudo ln -s /etc/nginx/sites-available/recast-republic /etc/nginx/sites-enabled/recast-republic
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.recastrepublic.com
```

Set `CORS_ORIGINS` in `/etc/recast-republic/store.env` to the exact frontend
origins, for example
`https://macsubido29-bit.github.io,https://www.recastrepublic.com`, then restart
the service. The frontend's `api-config.js` points the static page at
`https://api.recastrepublic.com`. GitHub Pages cannot run the Node.js/SQLite
backend; it hosts only the storefront files.

To update the app later, upload the changed source files, copy them into
`/opt/recast-republic/app`, rerun `npm ci --omit=dev --prefix
/opt/recast-republic/app` when dependencies change, and restart with
`sudo systemctl restart recast-republic`. Back up
`/var/lib/recast-republic/store.sqlite` securely and test restoring backups.

## Grant seller or admin access

New accounts are buyers by default and cannot grant themselves elevated access.
After creating the account, update its role in the local database with SQLite:

```sh
sqlite3 data/recast-republic.sqlite "update app_users set role='seller' where email='seller@example.com';"
sqlite3 data/recast-republic.sqlite "update app_users set role='admin' where email='recastrepublic29@gmail.com';"
```

If the SQLite CLI is not installed, use a SQLite database manager to run the
same `UPDATE` statements against `data/recast-republic.sqlite`. Sign out and
back in so the store reloads the role. Sellers can manage products, orders, and
buyer support messages. Admins can also restore the original catalog and
download a JSON export. Protect the database, backups, and downloaded exports as
sensitive personal data.
