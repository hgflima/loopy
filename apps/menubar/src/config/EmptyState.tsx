/**
 * EmptyState — the empty of the **Config tab** when a directory has no `loopy.yml`.
 *
 * Since D20 (C-0018) the tab bar is always visible: this no longer replaces the
 * whole `ViewSwitcher`, it degrades the Config tab, so `Specs` stays reachable in
 * a project that has no yml yet (authoring precedes the yml).
 *
 * Offers a single action: "Criar a partir do template" which seeds the
 * in-memory draft from `initialConfigTemplate` (R1). The file is NOT
 * written to disk until the user clicks Save (SC8).
 */
import { Button } from "../ui";
import "./EmptyState.css";

interface EmptyStateProps {
  readonly onCreateFromTemplate: () => void;
}

export function EmptyState({ onCreateFromTemplate }: EmptyStateProps) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-state__content">
        <h2 className="empty-state__title">Nenhum loopy.yml encontrado</h2>
        <p className="empty-state__hint t-label u-muted">
          Este diretório não possui um arquivo de configuração.
          Crie um a partir do template para começar.
        </p>
        <Button
          variant="primary"
          data-testid="btn-create-from-template"
          onClick={onCreateFromTemplate}
        >
          Criar loopy.yml a partir do template
        </Button>
      </div>
    </div>
  );
}
