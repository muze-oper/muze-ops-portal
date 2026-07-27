const router = require('express').Router();
const path = require('path');
const { execFileSync } = require('child_process');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
});

router.get('/api/me', (req, res) => {
  res.json({ email: req.user?.email || null });
});

router.get('/api/last-updated', (req, res) => {
  try {
    const [author, date] = execFileSync(
      'git',
      ['log', '-1', '--pretty=format:%an|%aI'],
      { cwd: path.join(__dirname, '..') }
    )
      .toString()
      .split('|');
    return res.json({ author, date });
  } catch (err) {
    return res.json({
      author: process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME || process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || null,
      date: null,
    });
  }
});

const REPO_ROOT = path.join(__dirname, '..');

function lastCommitDate(files) {
  try {
    const date = execFileSync('git', ['log', '-1', '--pretty=format:%aI', '--', ...files], {
      cwd: REPO_ROOT,
    })
      .toString()
      .trim();
    return date || null;
  } catch {
    return null;
  }
}

// "creator" is who owns/requested each tool, not who typed the code (one
// person commits nearly everything in this repo) - set manually per card.
const CARD_INFO = {
  digest: { creator: 'thiranattada', files: ['routes/digest.js', 'public/digest.html'] },
  planner: { creator: 'thiranattada', files: ['routes/planner.js', 'public/planner.html'] },
  mtscs: { creator: 'thiranattada', files: ['routes/mtscs.js', 'public/mtscs.html'] },
  'nissan-mn': { creator: 'thiranattada', files: ['routes/nissanMn.js', 'public/nissan-mn.html'] },
  // Hosted outside this repo - no local commit history to derive a date from.
  tvn: { creator: 'Chartwit', date: null },
  ktc: { creator: 'thiranattada', date: '2026-07-14T00:00:00+07:00' },
};

router.get('/api/card-info', (req, res) => {
  const result = {};
  for (const [id, cfg] of Object.entries(CARD_INFO)) {
    result[id] = { creator: cfg.creator, date: cfg.files ? lastCommitDate(cfg.files) : cfg.date };
  }
  res.json(result);
});

module.exports = router;
