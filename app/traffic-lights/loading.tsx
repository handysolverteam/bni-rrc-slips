export default function Loading() {
  return (
    <div>
      <div className="page-head">
        <h1>Traffic Lights</h1>
      </div>
      <div className="card report-controls">
        <div className="spinner" role="status" aria-label="Loading" />
      </div>
    </div>
  );
}
