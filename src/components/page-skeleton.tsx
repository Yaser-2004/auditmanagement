export default function PageSkeleton({ title = 'Loading page' }: { title?: string }) {
  return <div className="skeleton-page" role="status" aria-label={title} aria-busy="true"><span className="skeleton skeleton-line skeleton-heading"/><div className="skeleton-row">{Array.from({ length: 4 }, (_, i) => <span className="skeleton skeleton-card" key={i}/>)}</div><span className="skeleton skeleton-line"/><span className="skeleton skeleton-table"/><span className="sr-only">{title}…</span></div>;
}
