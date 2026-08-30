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
import { RoleMultiSelect } from "../components/role-multi-select";
import { useUpdateUserRolesMutation } from "../query";
import type { User, UserDetail } from "../types";

const rolesSchema = z.object({
  roleSlugs: z.array(z.string()).min(1, "At least one role is required"),
});

type RolesFormValues = z.infer<typeof rolesSchema>;

interface RoleAssignmentDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: User | UserDetail;
}

export function RoleAssignmentDialog({
  user,
  open,
  onOpenChange,
}: RoleAssignmentDialogProps) {
  const updateMutation = useUpdateUserRolesMutation();

  const form = useForm<RolesFormValues>({
    defaultValues: {
      roleSlugs: user.roleSlugs,
    },
    resolver: zodResolver(rolesSchema),
  });

  const { submit, isPending } = useMutationForm({
    form,
    mutation: updateMutation,
    onClose: () => onOpenChange(false),
    resetWhen: {
      key: user,
      open,
      values: { roleSlugs: user.roleSlugs },
    },
    toVariables: (values) => ({ data: values, userId: user.id }),
  });

  return (
    <FormDialog
      description={`Update role assignments for ${user.name}`}
      form={form}
      isPending={isPending}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      open={open}
      pendingLabel="Updating..."
      submitLabel="Update Roles"
      title="Manage Roles"
    >
      <FormField
        control={form.control}
        name="roleSlugs"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Roles</FormLabel>
            <FormControl>
              <RoleMultiSelect onChange={field.onChange} value={field.value} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialog>
  );
}
