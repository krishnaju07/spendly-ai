/** The scene behind the page: slow aurora blobs, a drifting dot grid and a light that follows the pointer. */
export function AuroraBackdrop() {
  return (
    <div className="aurora" aria-hidden>
      <span className="aurora-blob a" />
      <span className="aurora-blob b" />
      <span className="aurora-blob c" />
      <span className="aurora-dots" />
      <span className="aurora-spot" />
    </div>
  );
}
