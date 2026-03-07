import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { simpleGit } from 'simple-git';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'fuel-log.json');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Git instance
const git = simpleGit(__dirname);

// Utility: Load data from fuel-log.json
async function loadData() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.log('No data file found, returning empty array');
    return [];
  }
}

// Utility: Save data and commit to git
async function saveAndCommit(data, message) {
  try {
    // Write to file
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('📝 File written:', DATA_FILE);
    
    // Check if git is initialized
    try {
      await git.status();
    } catch (gitErr) {
      console.warn('⚠️  Git not initialized, initializing now...');
      await git.init();
      await git.config('user.email', 'tracker@localhost');
      await git.config('user.name', 'Car Tracker');
    }
    
    // Add to git
    await git.add('fuel-log.json');
    console.log('✓ File staged for git');
    
    // Commit
    try {
      await git.commit(message || 'Update fuel log data');
      console.log('✓ Committed to git:', message);
    } catch (commitErr) {
      // Commit might fail if nothing changed, that's OK
      console.log('ℹ️  Git commit note:', commitErr.message);
    }
    
    // Push to GitHub
    try {
      console.log('📤 Pushing to GitHub...');
      await git.push('origin', 'main');
      console.log('✓ Pushed to GitHub successfully');
    } catch (pushErr) {
      console.warn('⚠️  Push to GitHub failed:', pushErr.message);
      console.warn('ℹ️  Data saved locally, but not synced to GitHub');
    }
    
    return true;
  } catch (err) {
    console.error('❌ Error saving/committing:', err.message);
    throw err;
  }
}

// ============ API ENDPOINTS ============

// GET /api/data - Load all entries
app.get('/api/data', async (req, res) => {
  try {
    const data = await loadData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/data - Save entries (bulk)
app.post('/api/data', async (req, res) => {
  try {
    const { data, message } = req.body;
    await saveAndCommit(data, message || 'Update fuel log');
    res.json({ success: true, message: 'Data saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/entry - Add or update single entry
app.post('/api/entry', async (req, res) => {
  try {
    const { entry } = req.body;
    let data = await loadData();
    
    // Find and update or add new
    const idx = data.findIndex(e => e.id === entry.id);
    if (idx >= 0) {
      data[idx] = entry;
    } else {
      data.push(entry);
    }
    
    await saveAndCommit(data, `Update entry: ${entry.bunk || 'untitled'}`);
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/entry/:id - Delete entry
app.delete('/api/entry/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let data = await loadData();
    data = data.filter(e => e.id !== id);
    await saveAndCommit(data, `Delete entry: ${id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push - Push to remote (GitHub)
app.post('/api/push', async (req, res) => {
  try {
    await git.push();
    res.json({ success: true, message: 'Pushed to remote' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status - Get git status
app.get('/api/status', async (req, res) => {
  try {
    const status = await git.status();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚗 Car Mileage Tracker API running on http://localhost:${PORT}`);
  console.log(`📁 Data file: ${DATA_FILE}`);
  console.log(`📍 Git repo: ${__dirname}`);
});
