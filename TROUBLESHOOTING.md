# 🚗 Car Mileage Tracker - Troubleshooting Guide

## ❌ "Data not loading after login"

### Step 1: Verify the Server is Running
```bash
# Check if the server started without errors
# Output should show:
# 🚗 Car Mileage Tracker API running on http://localhost:3000
# 📁 Data file: /path/to/fuel-log.json
# 📍 Git repo: /path/to/repo
```

### Step 2: Check Browser Console for Errors
1. Open your browser's **Developer Tools** (F12)
2. Go to the **Console** tab
3. Look for error messages starting with ❌

**Expected log when you login:**
```
📡 Fetching data from API: http://localhost:3000/api/data
Response status: 200
✓ Data loaded from API: 0 entries
```

### Step 3: Test the API Directly

**PowerShell:**
```powershell
# Test GET /api/data
Invoke-WebRequest -Uri "http://localhost:3000/api/data"

# Should return: []  (empty array)
```

**Or use curl (if installed):**
```bash
curl http://localhost:3000/api/data
```

### Step 4: Common Issues & Fixes

#### Issue: "Cannot GET /api/data"
**Cause:** Server is not running  
**Fix:**
```bash
npm start
```

#### Issue: "Failed to load data. Is the server running on localhost:3000?"
**Cause:** Port 3000 is in use or server crashed  
**Fix:**
```bash
# Check what's using port 3000
netstat -ano | findstr :3000

# Kill the process (replace PID with actual number)
taskkill /PID <PID> /F

# Restart server
npm start
```

#### Issue: Git commit errors
**Cause:** Git not initialized in the directory  
**Fix:** The server will automatically initialize git on first save. Make sure git is installed:
```bash
git --version
```

#### Issue: Module not found errors
**Cause:** Dependencies not installed  
**Fix:**
```bash
npm install
```

---

## ✅ How to Verify Everything Works

1. **Start the server:**
   ```bash
   npm start
   ```
   Look for: `🚗 Car Mileage Tracker API running on http://localhost:3000`

2. **Open browser:** `http://localhost:3000`

3. **Login** with any username/password (min 3 chars username, 4 chars password)

4. **Add an entry** – click "Add Entry"

5. **Check the logs** – You should see:
   ```
   💾 Saving 1 entries to API...
   Response status: 200
   ✓ Data saved and committed to Git
   ```

6. **Verify file was created:**
   ```bash
   # Check if fuel-log.json exists and has data
   cat fuel-log.json
   
   # Check git log
   git log --oneline
   ```

---

## 🔍 Debug Checklist

- [ ] Server running (`npm start` shows no errors)
- [ ] Can access `http://localhost:3000` in browser
- [ ] Can login (any username/password)
- [ ] Can add entry (click "Add Entry" button)
- [ ] Console shows `✓ Data loaded from API`
- [ ] Console shows `✓ Data saved and committed to Git`
- [ ] `fuel-log.json` file exists in workspace
- [ ] Git is initialized (`git log` shows commits)

---

## 📞 Still Having Issues?

**Check these files for errors:**
1. Browser Console (F12 → Console tab)
2. Server terminal output (where you ran `npm start`)
3. Run with verbose logging:
   ```bash
   NODE_DEBUG=* npm start
   ```

