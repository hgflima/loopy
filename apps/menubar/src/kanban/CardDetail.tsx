/**
 * CardDetail — drawer shell for the selected card (D1/D2).
 *
 * This is the structural skeleton: header with task id + title + close button,
 * and an empty content area. Content (markdown desc, deps chips, log) comes
 * in T-011.
 */
import { useEffect } from "react";
import "./CardDetail.css";

export interface CardDetailProps {
  taskId: string;
  title: string;
  onClose: () => void;
}

export function CardDetail({ taskId, title, onClose }: CardDetailProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <aside className="card-detail" aria-label={`Detail for ${taskId}`}>
      <header className="card-detail__header">
        <span className="card-detail__id t-data">{taskId}</span>
        <span className="card-detail__title t-body">{title}</span>
        <button
          className="card-detail__close"
          onClick={onClose}
          aria-label="Close detail"
          type="button"
        >
          ✕
        </button>
      </header>
      <div className="card-detail__body" />
    </aside>
  );
}
