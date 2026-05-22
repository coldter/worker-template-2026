import type { FieldValues, UseFormReturn } from "react-hook-form";
import { Button } from "@/modules/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/modules/ui/dialog";
import { Form } from "@/modules/ui/form";

interface FormDialogProps<TValues extends FieldValues> {
  cancelLabel?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  description?: React.ReactNode;
  form: UseFormReturn<TValues>;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (e?: React.BaseSyntheticEvent) => void;
  open: boolean;
  pendingLabel: React.ReactNode;
  submitLabel: React.ReactNode;
  title: React.ReactNode;
}

export function FormDialog<TValues extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  isPending,
  submitLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  contentClassName = "sm:max-w-[425px]",
  children,
}: FormDialogProps<TValues>) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <Form {...form}>
          <form className="space-y-4" onSubmit={onSubmit}>
            {children}

            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                {cancelLabel}
              </Button>
              <Button disabled={isPending} type="submit">
                {isPending ? pendingLabel : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
