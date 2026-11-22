import type { PublicTeam } from "@kwistig/shared";

/** Team photo, or the team's emoji on its colour when there is no photo. */
export function TeamAvatar({
  team,
  size,
  className = "",
  rounded = "rounded-2xl",
}: {
  team: Pick<PublicTeam, "name" | "emoji" | "color" | "photoUrl">;
  size: number | string;
  className?: string;
  rounded?: string;
}) {
  const dim = typeof size === "number" ? `${size}px` : size;
  return team.photoUrl ? (
    <img
      src={team.photoUrl}
      alt={team.name}
      className={`shrink-0 object-cover ${rounded} ${className}`}
      style={{ width: dim, height: dim, boxShadow: `0 0 0 0.12em ${team.color}` }}
    />
  ) : (
    <span
      role="img"
      aria-label={team.name}
      className={`flex shrink-0 items-center justify-center ${rounded} ${className}`}
      style={{ width: dim, height: dim, background: team.color, fontSize: `calc(${dim} * 0.55)` }}
    >
      {team.emoji}
    </span>
  );
}
