import Image from 'next/image';
import { zones } from '@/data/zones';
import type { Mission } from '@/lib/types';

type Props = { mission: Mission; completedMissionIds: string[]; allMissions: Mission[] };

export default function WorldMap({ mission, completedMissionIds, allMissions }: Props) {
  const unlockedZoneIds = new Set(allMissions.filter((m) => completedMissionIds.includes(m.id)).map((m) => m.zoneId));
  unlockedZoneIds.add('base');
  unlockedZoneIds.add(mission.zoneId);

  return (
    <div className="world-grid" aria-label="Ember Camp map">
      {zones.map((zone) => {
        const current = zone.id === mission.zoneId;
        const unlocked = unlockedZoneIds.has(zone.id);
        return (
          <article key={zone.id} className={`tile tile-${zone.gridArea} ${current ? 'tile-current' : ''} ${unlocked ? 'tile-unlocked' : 'tile-locked'}`}>
            <span className="tile-kicker">{zone.subtitle}</span>
            <Image className="tile-art" src={zone.asset} alt="" width={150} height={110} priority={zone.id === 'base'} />
            <span className="tile-name">{zone.name}</span>
          </article>
        );
      })}
    </div>
  );
}
