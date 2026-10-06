// Category colours use dark text on pale backgrounds. Labels remain visible,
// so calendar identity never depends on colour alone.
const PALETTE = [
  { colour: '#2454a6', tint: '#eef4ff' },
  { colour: '#16736b', tint: '#edf8f6' },
  { colour: '#7942a4', tint: '#f6effb' },
  { colour: '#956500', tint: '#fff7df' },
  { colour: '#b23b50', tint: '#fff0f2' },
  { colour: '#38783e', tint: '#eef8ed' },
  { colour: '#176e93', tint: '#edf7fc' },
  { colour: '#a33d84', tint: '#fceff8' },
  { colour: '#b25520', tint: '#fff3e9' },
  { colour: '#504aa8', tint: '#f1f0fc' },
  { colour: '#86533e', tint: '#f8f0eb' },
  { colour: '#727422', tint: '#f5f6e8' },
];

function hashId(id) {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

export function assignCalendarColours(calendars, previous = []) {
  const colours = new Map(previous.map(calendar => [calendar.id, { colour: calendar.colour, tint: calendar.tint }]));
  const used = new Set(previous.filter(calendar => calendar.colour).map(calendar => calendar.colour));
  // Sort IDs for reproducible first-load colours even if Google changes ordering.
  for (const calendar of [...calendars].sort((a, b) => a.id.localeCompare(b.id))) {
    if (colours.get(calendar.id)?.colour) continue;
    const start = hashId(calendar.id) % PALETTE.length;
    let choice;
    for (let offset = 0; offset < PALETTE.length; offset++) {
      const candidate = PALETTE[(start + offset) % PALETTE.length];
      if (!used.has(candidate.colour)) { choice = candidate; break; }
    }
    // Additional calendars keep unique hues rather than reusing the palette.
    if (!choice) {
      let hue = hashId(calendar.id) % 360;
      while (used.has(`hsl(${hue} 55% 32%)`)) hue = (hue + 137.508) % 360;
      choice = { colour: `hsl(${hue} 55% 32%)`, tint: `hsl(${hue} 65% 96%)` };
    }
    used.add(choice.colour);
    colours.set(calendar.id, choice);
  }
  return calendars.map(calendar => ({ ...calendar, ...colours.get(calendar.id) }));
}
