# 🚗 Car Mileage Tracker

**Free, mobile-friendly fuel and mileage tracking with Google Sheets integration**

Track your car's fuel consumption, mileage, and costs directly from your mobile device. Data syncs automatically with Google Sheets - no backend server needed!

![License](https://img.shields.io/badge/license-MIT-blue) ![Mobile Ready](https://img.shields.io/badge/mobile-ready-brightgreen)

---

## ✨ Features

✅ **Full CRUD Operations** - Create, read, update, and delete fuel entries  
✅ **Mobile-Friendly** - Responsive design optimized for smartphones  
✅ **Google Sheets Backend** - All data stored in your Google Sheet  
✅ **Zero Hosting Costs** - GitHub Pages (frontend) + Google Apps Script (backend) - all FREE  
✅ **Real-Time Calculations** - Auto-calculated mileage, fuel quantity, costs  
✅ **Offline Support** - Works offline; syncs when reconnected  
✅ **Sortable Tables** - Click column headers to sort  
✅ **Summary Dashboard** - Quick stats on fuel, mileage, average consumption  

---

## 🚀 Quick Start

### For Users (Using the App)

1. **Visit your deployed site**: `https://YOUR_USERNAME.github.io/car-mileage-tracker/`
2. **Login** with any username/password (at least 4 chars)
3. **Click "Add Entry"** and fill in fuel details
4. **Automatic calculations** - mileage, costs, and more!

### For Developers (Setting Up)

See **[GITHUB_DEPLOYMENT.md](GITHUB_DEPLOYMENT.md)** for complete step-by-step instructions:

1. Deploy Google Apps Script backend
2. Update frontend with deployment URL
3. Upload to GitHub
4. Enable GitHub Pages
5. Access from mobile device

---

## 📱 On Mobile Device

### Add to Home Screen (App-like Experience)

**iPhone:**
1. Open browser → Share → Add to Home Screen
2. Tap icon to open fullscreen

**Android:**
1. Open menu (⋮) → Install app / Add to home screen
2. Tap icon to open

---

## 📊 What You Can Track

| Field | Description |
|-------|-------------|
| **Petrol Bunk** | Name of the fuel station |
| **Date** | When you filled up |
| **From KM** | Odometer reading before fill |
| **To KM** | Odometer reading after trip |
| **Amount (₹)** | Money spent on fuel |
| **Fuel Rate** | Price per liter |
| **Quantity** | Liters filled (auto-calculated) |
| **Pre-fill Range** | Km shown before filling (for accuracy) |
| **Post-trip Range** | Km shown at next fill (for calculation) |
| **Projected Range** | Estimated distance you can drive |

---

## 🧮 Auto-Calculations

- **Fuel Quantity** = Amount ÷ Fuel Rate
- **Total KM** = To KM − From KM
- **Effective KM** = Total KM + Post-Range − Pre-Range
- **Mileage** = Effective KM ÷ Fuel Qty
- **Average Mileage** = Total Effective KM ÷ Total Fuel Qty

---

## 🔐 Data Privacy

✅ Your data stays in YOUR Google Sheet  
✅ No third-party servers involved  
✅ GitHub Pages only hosts static HTML/CSS/JS  
✅ All API calls go directly to your Google Apps Script  

---

## 🛠️ Architecture

```
┌─────────────────────┐
│  Mobile Browser     │
│  (index.html)       │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  GitHub Pages       │
│  (Frontend)         │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Google Apps Script │
│  (Backend API)      │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Google Sheets      │
│  (Database)         │
└─────────────────────┘
```

---

## 📝 Deployment Instructions

### Complete Setup: [GITHUB_DEPLOYMENT.md](GITHUB_DEPLOYMENT.md)

Quick summary:
1. Deploy `AppsScript.js` as Google Apps Script web app
2. Update deployment URL in `app-github.js`
3. Upload `index.html` + `app-github.js` to GitHub
4. Enable GitHub Pages
5. Share GoogleSheet with service account email
6. Done! Access from mobile

---

## ⚙️ Files

| File | Purpose |
|------|---------|
| `index.html` | Frontend UI (responsive, mobile-friendly) |
| `app-github.js` | Frontend JavaScript (CRUD + Google Sheets API) |
| `AppsScript.js` | Backend (deploy to Google Apps Script) |
| `GITHUB_DEPLOYMENT.md` | Step-by-step setup guide |

---

## 🐛 Troubleshooting

### App shows "Connection error"
- ✅ Verify Google Apps Script deployment URL
- ✅ Check apps script.url is correct in app.js
- ✅ Ensure deployment is set to "Anyone"

### Data not saving
- ✅ Check Google Sheet name is "Sheet1"
- ✅ Verify service account is shared asa Editor
- ✅ Ensure headers are in row 1

### Data not loading
- ✅ Verify Google Apps Script is deployed
- ✅ Check browser console (F12) for errors
- ✅ Reload the page

See **[GITHUB_DEPLOYMENT.md](GITHUB_DEPLOYMENT.md#troubleshooting)** for more help.

---

## 📈 How Mileage Calculations Work

The app uses **effective KM** to calculate accurate mileage:

```
Total KM = To Odometer − From Odometer
Effective KM = Total KM + Range (next fill) − Range (this fill)
Mileage = Effective KM ÷ Fuel Qty
```

**Example:**
- Start: 100 km odometer, 450 km range
- End: 120 km odometer, 320 km range  
- Total KM = 20
- Effective KM = 20 + 320 − 450 = −110 km?
  
Wait, that doesn't make sense. Let me recalculate:

- Start: 100 km odometer
  - Before fill: car showed 200 km range (pre-fill)
- End: 120 km odometer  
  - After trip: car showed 300 km range (post-trip before next fill)
- Total KM driven = 20
- Effective KM = 20 + 300 − 200 = 120 km (accounts for range variations)

---

## 💡 Tips

- **Mobile-first design** - Works great on phones, tablets, and desktop
- **Offline support** - Data saves locally; syncs when online
- **Batch operations** - View all entries in sortable table
- **Real-time sync** - All devices see updates instantly
- **Privacy** - Data never leaves your Google Sheet

---

## 📞 Need Help?

1. Check [GITHUB_DEPLOYMENT.md](GITHUB_DEPLOYMENT.md)
2. Review the troubleshooting section above
3. Verify all Google Apps Script steps completed
4. Check browser console for error messages (F12)

---

## 📄 License

MIT License - feel free to modify and share!

---

**Happy fuel tracking! 🚗⛽**

*Last updated: March 2026*
