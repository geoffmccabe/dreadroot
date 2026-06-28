// BuildToolsDock — the shared right-side column that owns vertical space for the BUILD tools
// and auto-stacks them top-to-bottom (flex column), so they never overlap and reflow when one
// opens/closes. Visible only in build/author mode (backtick), and only for users who can edit.
// Mounted once in FortressHUD so it appears in BOTH games. Today it holds the Arrange panel;
// the Object Placer (Builder) folds in here next.
import { useEditMode, useCanEdit } from './store';
import { ArrangePanel } from './ArrangePanel';

export function BuildToolsDock() {
  const editMode = useEditMode();
  const canEdit = useCanEdit();
  if (!editMode || !canEdit) return null;
  return (
    <div className="fixed right-4 top-1/2 z-50 flex -translate-y-1/2 flex-col gap-3">
      {/* Object Placer panel folds in here (above Arrange) in the next step. */}
      <ArrangePanel />
    </div>
  );
}
