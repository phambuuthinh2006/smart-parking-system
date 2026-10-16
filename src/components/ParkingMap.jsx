import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, MousePointer2, CircleHelp } from "lucide-react";
import Car from "./Car";
export function Status({ status }) {
  return (
    <span className={`status status-${status}`}>
      <i />
      {status}
    </span>
  );
}
export default function ParkingMap({ spaces, selected, onSelect }) {
  const reduced = useReducedMotion();
  return (
    <section className="panel map-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">A LIVE VIEW OF YOUR LOT</div>
          <h2>
            Parking overview <span className="subtle-badge">Lot A</span>
          </h2>
        </div>
        <span className="view-tag">
          <span className="tiny-dot" />2 × 2 layout
        </span>
      </div>
      <div className="map-wrap">
        <div className="lot-sign">
          <span>UNIVERSITY PARKING</span>
          <span>
            ZONE A <span className="sign-p">P</span>
          </span>
        </div>
        <div className="parking-lot">
          <div className="lane">
            <span className="lane-label">ENTRY</span>
            <ArrowDown className="entry-arrow" size={21} />
            <div className="lane-dashes" />
            <ArrowDown className="exit-arrow" size={21} />
            <span className="lane-label">EXIT</span>
          </div>
          {spaces.map((space, index) => (
            <button
              key={space.id}
              className={`bay bay-${index} bay-${space.status} ${selected === space.id ? "bay-selected" : ""}`}
              onClick={() => onSelect(space.id)}
              aria-label={`${space.id}, ${space.status}. Select parking space`}
              aria-pressed={selected === space.id}
            >
              <div className="bay-top">
                <span className="bay-number">{space.id}</span>
                <span className={`bay-dot ${space.status}`} />
              </div>
              <div className="vehicle-area">
                <AnimatePresence mode="wait">
                  {space.status === "occupied" ? (
                    <motion.div
                      key="car"
                      className={`vehicle vehicle-${index}`}
                      initial={{
                        opacity: 0,
                        x: reduced ? 0 : index % 2 ? -35 : 35,
                      }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{
                        opacity: 0,
                        x: reduced ? 0 : index % 2 ? -35 : 35,
                      }}
                      transition={{ duration: 0.35 }}
                    >
                      <Car variant={index < 2 ? "blue" : "silver"} />
                    </motion.div>
                  ) : (
                    <motion.span
                      key={space.status}
                      className="empty-space"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      {space.status === "available" ? (
                        <span className="empty-p">P</span>
                      ) : (
                        <CircleHelp size={31} />
                      )}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <span className={`bay-status ${space.status}`}>
                {space.status}
              </span>
            </button>
          ))}
        </div>
        <div className="map-bottom">
          <span>
            <ArrowUp size={14} />
            One-way access
          </span>
          <span>4 standard spaces</span>
        </div>
      </div>
      <div className="map-legend">
        <div>
          <span>
            <i className="legend-dot available" />
            Available
          </span>
          <span>
            <i className="legend-dot occupied" />
            Occupied
          </span>
          <span>
            <i className="legend-dot unknown" />
            Unknown
          </span>
        </div>
        <span className="map-hint">
          <MousePointer2 size={13} />
          Select a space to update
        </span>
      </div>
    </section>
  );
}
