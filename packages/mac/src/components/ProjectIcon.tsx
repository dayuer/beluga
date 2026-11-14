import { useProjectIcon } from '../lib/projects.js';
import { type RowColor, tileHue } from '../lib/row-colors.js';
import s from './ProjectIcon.module.css';

/**
 * A project's own icon (its app icon, favicon or logo, or one you chose), else a tile with its
 * initial: you find a project by its look, like apps in the Dock.
 */
/** `id`: a project's id, or `path:<folder>` for a folder that isn't one yet. `color`: one you gave the project, for its letter tile. */
export function ProjectIcon({ id, name, size = 16, color }: { id: string; name: string; size?: number; color?: RowColor | undefined }) {
  const icon = useProjectIcon(id);
  const radius = Math.round(size * 0.24);
  if (icon) return <img className={s.image} src={icon} alt="" width={size} height={size} style={{ borderRadius: radius }} draggable={false} />;
  return (
    <span className={color ? `${s.tile} ${s.tint}` : s.tile} style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.58, ...(color ? { ['--h' as string]: tileHue(color) } : {}) }} aria-hidden="true">
      {/* Before the icon is known, an empty tile (no flash of a letter, then a picture). */}
      {icon === null ? (name.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase() : null}
    </span>
  );
}
