// Confirmation modal for tree chopping
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TreeChopConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  treeName?: string;
}

export function TreeChopConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  treeName = "this tree"
}: TreeChopConfirmModalProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="bg-background/95 backdrop-blur-sm border-primary/20">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl">Chop down {treeName}?</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            This will remove the entire tree and return the seed to your inventory.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Chop Tree
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
