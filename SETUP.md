# Car Mileage Tracker - Git-Based Storage Setup

Your app now loads data from your GitHub repository and saves changes to local Git.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```

The server will start on `http://localhost:3000`

### 3. Open Your Browser
Navigate to `http://localhost:3000` and login.

## 📡 How It Works

### Data Flow:
1. **Load**: Data is fetched from GitHub RAW URL (read-only)
   - Source: `https://raw.githubusercontent.com/PK-Git-1/punchu/main/fuel-log.json`
   - No authentication needed for reading public repos

2. **Edit**: You can add/edit/delete entries in the browser

3. **Save**: Changes are saved to `fuel-log.json` and committed to local Git
   - Requires: Node.js server running on localhost:3000

4. **Push to GitHub**: Manual step to sync with your GitHub repo
   ```bash
   git push origin main
   ```

## 🔧 API Endpoints

- `GET /api/data` - Load all entries from file system
- `POST /api/data` - Save all entries (with git commit)
- `POST /api/entry` - Add/update single entry
- `DELETE /api/entry/:id` - Delete entry
- `POST /api/push` - Push changes to remote
- `GET /api/status` - Get Git status

## 📚 File Structure

```
.
├── server.js              # Node.js backend (handles local git commits)
├── app.js                 # Frontend (loads from GitHub, saves to server)
├── index.html             # UI
├── package.json           # Dependencies
├── fuel-log.json          # Local data copy
└── commit_push.sh         # Git script (optional)
```

## 🔐 Authentication

- Login with any username (3+ chars) and password (4+ chars)
- Credentials are **not saved** - session only
- GitHub data loading is public (no auth needed)

## 📤 Syncing with GitHub

### View your GitHub repo:
```
https://pk-git-1.github.io/punchu/
https://github.com/PK-Git-1/punchu
```

### Push changes to GitHub:
```bash
# After making changes and saving
git add fuel-log.json
git commit -m "Update fuel log"
git push origin main
```

Or use the API:
```bash
curl -X POST http://localhost:3000/api/push
```

## ⚠️ Important Notes

1. The server must be running for the app to work
2. Changes are auto-committed to **local** Git, not GitHub
3. You must manually `git push` to update your GitHub repo
4. Closing the browser doesn't lose data (it's in local Git)
5. All GitHub data is loaded fresh each time you login

## 🐛 Troubleshooting

**"Failed to load data from GitHub"**
- Check your internet connection
- Verify GitHub repo is public
- Try visiting the raw URL directly in browser

**Cannot save data**
- Make sure server is running: `npm start`
- Check that Git is configured:
  ```bash
  git config user.email "you@example.com"
  git config user.name "Your Name"
  ```

**Port 3000 already in use**
Edit `server.js` and change `PORT = 3000` to another number

---

Happy tracking! 🚗⛽
