# orchard-net
A messaging app for texting and sending photos.

## Local run

```bash
npm install
npm start
```

Open http://localhost:3000

## Deploy to a hosted internet domain

This app is ready for deployment to a public host such as Railway, Render, Fly.io, or a VM with a domain.

### Recommended setup: Railway
1. Push this folder to GitHub.
2. Sign in to Railway and create a new project.
3. Import the GitHub repo.
4. Railway will detect the Node app automatically.
5. Add these environment variables:
   - `JWT_SECRET`
   - `PORT` (Railway sets this automatically)
6. Deploy the project.
7. Add a custom domain in Railway and update the DNS records it gives you.
8. Your app will become publicly accessible at a domain such as `https://orchard-net.up.railway.app` or your custom domain.

### Required environment variables

Copy `.env.example` to `.env` and adjust values:

```bash
cp .env.example .env
```

### Notes
- The app uses SQLite locally in the project folder.
- On Railway, the SQLite database is ephemeral unless you attach persistent storage.
- Photos upload to the `uploads/` folder; for a production setup, consider persistent storage or cloud object storage.
- The included `railway.json` file tells Railway how to start the app and health-check it.
