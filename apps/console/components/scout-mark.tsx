/** Scout agent mark — dual-spark symbol (Claude-style, unique to QA Scout). */
export function ScoutMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M11.75 2.1c.52 2.72 2.02 4.22 4.74 4.74-2.72.52-4.22 2.02-4.74 4.74-.52-2.72-2.02-4.22-4.74-4.74 2.72-.52 4.22-2.02 4.74-4.74Z"
        fill="currentColor"
      />
      <path
        d="M14.35 11.35c.42 2.05 1.63 3.26 3.68 3.68-2.05.42-3.26 1.63-3.68 3.68-.42-2.05-1.63-3.26-3.68-3.68 2.05-.42 3.26-1.63 3.68-3.68Z"
        fill="currentColor"
      />
    </svg>
  );
}
