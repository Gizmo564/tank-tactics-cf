// Game configuration: defaults, presets, field specs and sanitising.
// Pure data + functions — no I/O — so it runs identically in the Worker,
// in Durable Objects, and in plain Node tests.

export const DEFAULT_CONFIG = {
  gridWidth: 12, gridHeight: 12, maxPlayers: 12,
  startingHearts: 3, startingAP: 0, startingRange: 2,
  maxHearts: 10, maxRange: 10,
  moveCost: 1, shootCost: 1, addHeartCost: 3, upgradeRangeCost: 3,
  apPerDay: 1, apSchedule: 'workdays', apIntervalHours: 24, apGrantWindowHours: 2,
  heartSpawnEnabled: true, heartSpawnIntervalHours: 24, heartSpawnRandomWindowHours: 8, maxHeartsOnBoard: 3,
  friendlyFire: true, transferAPOnKill: true, shootDamage: 1,
  juryEnabled: true, hauntingEnabled: true, giftingEnabled: true, giftingRequiresRange: true,
  endgamePlayerCount: 4, maxChatMessages: 500,
  chatBroadcastEnabled: true, chatWhisperEnabled: true,
  actionLogEnabled: true, actionLogWindow: 'full',
  fogOfWarEnabled: false, teamsEnabled: false, teamCount: 2, teamFriendlyFireEnabled: false,
  winCondition: 'lastStanding', killTargetCount: 5
};

export const COLORS = [
  { id: 'coral', hex: '#ff6b5e' }, { id: 'mustard', hex: '#e8a83c' },
  { id: 'teal', hex: '#2f9e8f' }, { id: 'sky', hex: '#4a9fd8' },
  { id: 'plum', hex: '#9b6bd6' }, { id: 'mint', hex: '#4fbf7f' },
  { id: 'tangerine', hex: '#f2894e' }, { id: 'rose', hex: '#e8628f' },
  { id: 'olive', hex: '#9a9d3f' }, { id: 'slate', hex: '#5c7599' }
];

const D = DEFAULT_CONFIG;
export const PRESETS = [
  { id: 'quick', label: 'Quick Skirmish', blurb: 'Small board, fast AP — done in an afternoon.',
    overrides: { ...D, gridWidth: 8, gridHeight: 8, maxPlayers: 6, startingHearts: 3, startingRange: 2,
      apPerDay: 1, apSchedule: 'always', apIntervalHours: 2, apGrantWindowHours: 0.5,
      heartSpawnEnabled: true, heartSpawnIntervalHours: 5, heartSpawnRandomWindowHours: 2, maxHeartsOnBoard: 2,
      endgamePlayerCount: 2, chatBroadcastEnabled: true, chatWhisperEnabled: true, actionLogEnabled: true, actionLogWindow: 'full' } },
  { id: 'singleDay', label: 'Single-Day Blitz', blurb: 'Everyone gets AP every couple hours, and everything is said in the open — no whispers, wraps up in one day.',
    overrides: { ...D, gridWidth: 10, gridHeight: 10, maxPlayers: 10, startingHearts: 3, startingRange: 2,
      apPerDay: 1, apSchedule: 'always', apIntervalHours: 1.5, apGrantWindowHours: 0.25,
      heartSpawnEnabled: true, heartSpawnIntervalHours: 3, heartSpawnRandomWindowHours: 1, maxHeartsOnBoard: 3,
      endgamePlayerCount: 3, chatBroadcastEnabled: true, chatWhisperEnabled: false, actionLogEnabled: true, actionLogWindow: 'full' } },
  { id: 'standard', label: 'Standard Campaign', blurb: 'The classic pace — one AP a day, full chat, groups, and history, runs over a few weeks.',
    overrides: { ...D } },
  { id: 'large', label: 'Large Campaign', blurb: 'A big board for a big roster. The action log only shows the last 24 hours so it doesn’t drown in 30 players’ worth of moves — chat and groups still work fine.',
    overrides: { ...D, gridWidth: 20, gridHeight: 20, maxPlayers: 30, startingHearts: 3, startingRange: 2,
      apPerDay: 1, apSchedule: 'workdays', apIntervalHours: 24, apGrantWindowHours: 3,
      heartSpawnEnabled: true, heartSpawnIntervalHours: 16, heartSpawnRandomWindowHours: 6, maxHeartsOnBoard: 6,
      endgamePlayerCount: 6, chatBroadcastEnabled: true, chatWhisperEnabled: true, actionLogEnabled: true, actionLogWindow: '24h' } },
  { id: 'custom', label: 'Custom', blurb: 'Start from Standard and change anything you like.', overrides: { ...D } }
];

export const FIELD_SPEC = [
  { key: 'gridWidth', label: 'Board width', group: 'board', min: 5, max: 40, type: 'int' },
  { key: 'gridHeight', label: 'Board height', group: 'board', min: 5, max: 40, type: 'int' },
  { key: 'maxPlayers', label: 'Max tanks', group: 'board', min: 2, max: 60, type: 'int' },
  { key: 'startingHearts', label: 'Starting hearts', group: 'board', min: 1, max: 20, type: 'int' },
  { key: 'startingRange', label: 'Starting range', group: 'board', min: 1, max: 15, type: 'int' },
  { key: 'maxHearts', label: 'Max hearts', group: 'board', min: 1, max: 30, type: 'int' },
  { key: 'maxRange', label: 'Max range', group: 'board', min: 1, max: 30, type: 'int' },
  { key: 'apPerDay', label: 'AP per grant', group: 'ap', min: 1, max: 20, type: 'int' },
  { key: 'apIntervalHours', label: 'Hours between grants', group: 'ap', min: 0.25, max: 168, type: 'float' },
  { key: 'apGrantWindowHours', label: 'Random jitter (hours)', group: 'ap', min: 0, max: 24, type: 'float' },
  { key: 'apSchedule', label: 'Schedule', group: 'ap', type: 'enum', options: ['always', 'workdays'] },
  { key: 'moveCost', label: 'Move cost', group: 'economy', min: 0, max: 10, type: 'int' },
  { key: 'shootCost', label: 'Shoot cost', group: 'economy', min: 0, max: 10, type: 'int' },
  { key: 'addHeartCost', label: 'Repair cost', group: 'economy', min: 0, max: 20, type: 'int' },
  { key: 'upgradeRangeCost', label: 'Range upgrade cost', group: 'economy', min: 0, max: 20, type: 'int' },
  { key: 'heartSpawnEnabled', label: 'Heart pickups spawn', group: 'combat', type: 'bool' },
  { key: 'heartSpawnIntervalHours', label: 'Heart spawn interval (hrs)', group: 'combat', min: 0.5, max: 168, type: 'float' },
  { key: 'heartSpawnRandomWindowHours', label: 'Heart spawn jitter (hrs)', group: 'combat', min: 0, max: 48, type: 'float' },
  { key: 'maxHeartsOnBoard', label: 'Max hearts on board', group: 'combat', min: 0, max: 20, type: 'int' },
  { key: 'friendlyFire', label: 'Allow self-shooting', group: 'combat', type: 'bool' },
  { key: 'transferAPOnKill', label: 'Transfer AP on kill', group: 'combat', type: 'bool' },
  { key: 'shootDamage', label: 'Shoot damage', group: 'combat', min: 1, max: 10, type: 'int' },
  { key: 'juryEnabled', label: 'Jury voting', group: 'social', type: 'bool' },
  { key: 'hauntingEnabled', label: 'Haunting (jury can skip AP)', group: 'social', type: 'bool' },
  { key: 'giftingEnabled', label: 'Gifting', group: 'social', type: 'bool' },
  { key: 'giftingRequiresRange', label: 'Gifting requires range', group: 'social', type: 'bool' },
  { key: 'chatBroadcastEnabled', label: 'Bulletin messaging (to all players)', group: 'messaging', type: 'bool' },
  { key: 'chatWhisperEnabled', label: 'Private messaging (1-to-1 and groups)', group: 'messaging', type: 'bool' },
  { key: 'actionLogEnabled', label: 'Action history visible to players', group: 'messaging', type: 'bool' },
  { key: 'actionLogWindow', label: 'History window', group: 'messaging', type: 'enum', options: ['full', '24h'] },
  { key: 'fogOfWarEnabled', label: 'Fog of war (only see tanks within your range)', group: 'teams', type: 'bool' },
  { key: 'teamsEnabled', label: 'Teams', group: 'teams', type: 'bool' },
  { key: 'teamCount', label: 'Number of teams', group: 'teams', min: 2, max: 6, type: 'int' },
  { key: 'teamFriendlyFireEnabled', label: 'Allow shooting teammates', group: 'teams', type: 'bool' },
  { key: 'winCondition', label: 'Win condition', group: 'teams', type: 'enum', options: ['lastStanding', 'lastTeamStanding', 'killTarget'] },
  { key: 'endgamePlayerCount', label: 'lastStanding: end when N or fewer tanks remain (co-winners if >1)', group: 'teams', min: 1, max: 20, type: 'int' },
  { key: 'killTargetCount', label: 'killTarget: kills needed to win', group: 'teams', min: 1, max: 50, type: 'int' }
];

export function sanitizeConfig(input) {
  const out = { ...DEFAULT_CONFIG };
  for (const f of FIELD_SPEC) {
    const raw = input ? input[f.key] : undefined;
    if (raw === undefined || raw === null || raw === '') continue;
    if (f.type === 'int') { const v = parseInt(raw); if (!isNaN(v)) out[f.key] = Math.max(f.min, Math.min(f.max, v)); }
    else if (f.type === 'float') { const v = parseFloat(raw); if (!isNaN(v)) out[f.key] = Math.max(f.min, Math.min(f.max, v)); }
    else if (f.type === 'bool') out[f.key] = !!raw;
    else if (f.type === 'enum') { if (f.options.includes(raw)) out[f.key] = raw; }
  }
  if (out.maxHearts < out.startingHearts) out.maxHearts = out.startingHearts;
  if (out.maxRange < out.startingRange) out.maxRange = out.startingRange;
  return out;
}
