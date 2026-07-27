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

module.exports = router;
