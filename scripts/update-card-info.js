// Regenerates the git-derived fields in card-info.json. Run this (npm run
// update-card-info) after committing changes to a card's backing files, then
// commit the updated card-info.json too. Vercel's serverless functions don't
// ship .git or a git binary, so this can't be computed at request time in
// production - it has to be baked into a static file at commit time instead.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CARD_INFO_PATH = path.join(REPO_ROOT, 'card-info.json');

const GIT_BACKED_CARDS = {
  digest: ['routes/digest.js', 'public/digest.html'],
  planner: ['routes/planner.js', 'public/planner.html'],
  // Both cards link into the same /mtscs page (tabs), so both track it as a
  // shared backing file alongside their own route.
  mtscs: ['routes/mtscs.js', 'public/mtscs.html'],
  'nissan-mn': ['routes/nissanMn.js', 'public/mtscs.html'],
  'tvn-dashboard': ['routes/tvn.js', 'public/tvn.html'],
  'ktc-chat': ['routes/ktcChat.js', 'public/ktc-chat.html', 'services/jiraKtc.js', 'services/ktcHandoverSearch.js', 'data/ktc-handover.md'],
  'tvs-kb': ['routes/kb.js', 'public/tvs-error-code-kb.html'],
  tdg: ['apps-script/muze-tdg-dashboard'],
  'resource-planning': ['routes/resourcePlanning.js', 'public/resource-planning.html', 'storage/googleSheets.js'],
};

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

function lastPortalCommit() {
  try {
    const [author, date] = execFileSync('git', ['log', '-1', '--pretty=format:%an|%aI'], {
      cwd: REPO_ROOT,
    })
      .toString()
      .split('|');
    return { author, date };
  } catch {
    return { author: null, date: null };
  }
}

const cardInfo = JSON.parse(fs.readFileSync(CARD_INFO_PATH, 'utf8'));

for (const [id, files] of Object.entries(GIT_BACKED_CARDS)) {
  cardInfo[id] = { ...cardInfo[id], date: lastCommitDate(files) };
}
cardInfo._portal = lastPortalCommit();

fs.writeFileSync(CARD_INFO_PATH, JSON.stringify(cardInfo, null, 2) + '\n');
console.log('card-info.json updated:', JSON.stringify(cardInfo, null, 2));
