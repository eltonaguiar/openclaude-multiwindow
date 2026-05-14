const fs = require('fs');
const filePath = __dirname + '/../src/chat/providerCatalog.json';
let c = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Update inception-direct with more Mercury models
for (const p of c) {
  if (p.id === 'inception-direct') {
    p.models = [
      { id: 'mercury-2', label: 'Mercury 2' },
      { id: 'mercury-2-5b', label: 'Mercury 2 (5B)' },
      { id: 'mercury-coder', label: 'Mercury Coder' },
      { id: 'mercury-edit-2', label: 'Mercury Edit 2' },
      { id: 'mercury-edit', label: 'Mercury Edit' },
      { id: 'mercury', label: 'Mercury (Legacy)' },
    ];
  }
}

fs.writeFileSync(filePath, JSON.stringify(c, null, 2) + '\n');
console.log('providerCatalog.json updated with full Mercury models');
