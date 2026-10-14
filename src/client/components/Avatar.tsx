const COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#4dabf7", "#9775fa", "#f783ac", "#38d9a9"];

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const color = COLORS[hash(name) % COLORS.length];
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.45 }}>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
