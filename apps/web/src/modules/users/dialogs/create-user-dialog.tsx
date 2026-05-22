import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useMutationForm } from "@/hooks/use-mutation-form";
import { FormDialog } from "@/modules/common/form-dialog";
import { PasswordInput } from "@/modules/common/password-input";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/modules/ui/form";
import { Input } from "@/modules/ui/input";
import { RoleMultiSelect } from "../components/role-multi-select";
import { useCreateUserMutation } from "../query";

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  roleSlugs: z.array(z.string()).min(1, "At least one role is required"),
});

type CreateUserFormValues = z.infer<typeof createUserSchema>;

interface CreateUserDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function CreateUserDialog({
  open,
  onOpenChange,
}: CreateUserDialogProps) {
  const createMutation = useCreateUserMutation();

  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      roleSlugs: [],
    },
  });

  const { submit, isPending } = useMutationForm({
    form,
    mutation: createMutation,
    toVariables: (values) => values,
    onClose: () => onOpenChange(false),
    resetOnSuccess: true,
  });

  return (
    <FormDialog
      description="Add a new user to the system. They will receive login credentials."
      form={form}
      isPending={isPending}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      open={open}
      pendingLabel="Creating..."
      submitLabel="Create User"
      title="Create User"
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input placeholder="John Doe" {...field} />
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
              <Input placeholder="john@example.com" type="email" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="password"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Password</FormLabel>
            <FormControl>
              <PasswordInput placeholder="Enter password" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

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
