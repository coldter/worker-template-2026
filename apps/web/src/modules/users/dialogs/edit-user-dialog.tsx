import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useMutationForm } from "@/hooks/use-mutation-form";
import { FormDialog } from "@/modules/common/form-dialog";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/modules/ui/form";
import { Input } from "@/modules/ui/input";

import { useUpdateUserMutation } from "../query";
import type { User, UserDetail } from "../types";

const editUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(1, "Name is required").max(100),
});

type EditUserFormValues = z.infer<typeof editUserSchema>;

interface EditUserDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: User | UserDetail;
}

export function EditUserDialog({
  user,
  open,
  onOpenChange,
}: EditUserDialogProps) {
  const updateMutation = useUpdateUserMutation();

  const form = useForm<EditUserFormValues>({
    defaultValues: {
      email: user.email,
      name: user.name,
    },
    resolver: zodResolver(editUserSchema),
  });

  const { submit, isPending } = useMutationForm({
    form,
    mutation: updateMutation,
    onClose: () => onOpenChange(false),
    resetWhen: {
      key: user,
      open,
      values: { email: user.email, name: user.name },
    },
    toVariables: (values) => ({ data: values, userId: user.id }),
  });

  return (
    <FormDialog
      description="Update user profile information"
      form={form}
      isPending={isPending}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      open={open}
      pendingLabel="Saving..."
      submitLabel="Save Changes"
      title="Edit User"
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input type="email" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialog>
  );
}
