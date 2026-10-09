import { Bar } from "@/components/Skeletons";

/** Settings skeleton: the page head and the three cards (not the Home skeleton). */
export default function Loading() {
  return (
    <div>
      <div className="page-head">
        <h1>Settings</h1>
        <Bar w={320} h={14} />
      </div>
      <div className="settings-grid">
        {[0, 1, 2].map((i) => (
          <section key={i} className="card">
            <Bar w={160} h={20} />
            <div style={{ height: 8 }} />
            <Bar w="70%" h={14} />
            <div className="settings-row">
              <Bar w="100%" h={42} r={10} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
