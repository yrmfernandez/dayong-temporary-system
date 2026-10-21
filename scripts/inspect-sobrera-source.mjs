// Read-only original New Sales rows for the owner-confirmed merged member.
import { loadLegacySources } from './legacy-sources.mjs';
import fs from 'node:fs';
const sources = await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
const found = [];
for (const source of sources) for (const tab of source.tabs.filter((t) => t.title.endsWith('NS'))) {
  const [headers, ...rows] = tab.rows;
  rows.forEach((row, index) => {
    const person = String(row[headers.findIndex((h) => String(h).trim() === 'PH/MEMBER')] ?? '');
    if (/SOBRERA/i.test(person) && /JHASSEL/i.test(person)) {
      found.push({ ref: `Data-Base-Old|${tab.title}|${tab.firstRow + index + 1}`, cells: headers.map((h, i) => ({ header: String(h), value: row[i] })) });
    }
  });
}
fs.writeFileSync('legacy-data/sobrera-new-sales-source.json', JSON.stringify(found, null, 2));
console.log(JSON.stringify(found, null, 2));
