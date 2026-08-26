import type { Zone } from '@/lib/types';

export const zones: Zone[] = [
  { id: 'woods', name: 'Pine Woods', subtitle: 'FOREST', asset: '/assets/world/woods.svg', gridArea: 'woods' },
  { id: 'cookfire', name: 'Cookfire', subtitle: 'CAMP', asset: '/assets/world/cookfire.svg', gridArea: 'cookfire' },
  { id: 'river', name: 'Riverbank', subtitle: 'RIVER', asset: '/assets/world/river.svg', gridArea: 'river' },
  { id: 'market', name: 'Trading Post', subtitle: 'TRADERS', asset: '/assets/world/market.svg', gridArea: 'market' },
  { id: 'base', name: 'Ember Camp', subtitle: 'BASE', asset: '/assets/world/base.svg', gridArea: 'base' },
  { id: 'bridge', name: 'Broken Bridge', subtitle: 'OUTSKIRTS', asset: '/assets/world/bridge.svg', gridArea: 'bridge' },
  { id: 'ridge', name: 'North Ridge', subtitle: 'RIDGE', asset: '/assets/world/ridge.svg', gridArea: 'ridge' },
  { id: 'council', name: 'Council Hall', subtitle: 'COUNCIL', asset: '/assets/world/council.svg', gridArea: 'council' },
  { id: 'gate', name: 'Northern Gate', subtitle: 'FRONTIER', asset: '/assets/world/gate.svg', gridArea: 'gate' },
];
