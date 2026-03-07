# 🚀 Quick Setup In 3 Steps

## Step 1: Install Dependencies (First Time Only)
```bash
npm install
```

## Step 2: Start the Server
```bash
npm start
```

Expected output:
```
🚗 Car Mileage Tracker API running on http://localhost:3000
📁 Data file: C:\...\fuel-log.json
📍 Git repo: C:\...\Punch
```

## Step 3: Open Your Browser
👉 Go to: **http://localhost:3000**

---

## 🔑 Login Credentials  
- **Username:** Any name (min 3 characters) - e.g., `user1`
- **Password:** Any password (min 4 characters) - e.g., `pass`

---

## � Data Source

✅ **Data loads from GitHub:**
- Repository: https://github.com/PK-Git-1/punchu
- File: `fuel-log.json`
- Console shows: `✓ Data loaded from GitHub: N entries`

---

## 📝 What Should Happen

✅ **After Login:**
- You should see the fuel log page
- Console shows: `✓ Data loaded from GitHub: X entries` (from your repo)
- You can click "Add Entry" to add a fuel log entry
- Data saves to local Git at `fuel-log.json`

✅ **After Adding Entry:**
- Console shows: `✓ Data saved and committed to Git`
- Check your workspace - `fuel-log.json` will have your entry
- To sync with GitHub: `git push origin main`

---

## ❌ If Something's Wrong

**Q: "Failed to load data from GitHub"**
- A: Check your internet connection
- A: Verify the GitHub repo is public
- A: Try visiting https://github.com/PK-Git-1/punchu in browser

**Q: "Failed to save data. Server error"**
- A: Make sure the terminal shows `🚗 Car Mileage Tracker API running...`
- A: If not, restart with `npm start`

**Q: "Module not found" error**
- A: Run `npm install` first

**Q: Port 3000 already in use**
- A: Close other apps using port 3000, or edit `server.js` line 5 to change the PORT

**Q: Need more help?**
- See `TROUBLESHOOTING.md` for detailed debugging steps

---

## 🎯 Test It Now

1. **Add an entry** with fuel details
2. **Check console** (F12) - you should see save logs
3. **Verify file** was created:
   ```bash
   cat fuel-log.json
   ```
4. **Push to GitHub** (optional):
   ```bash
   git push origin main
   ```

Done! 🎉
