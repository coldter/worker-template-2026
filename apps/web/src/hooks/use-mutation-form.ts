import { useEffect, useRef } from "react";
import type {
  DefaultValues,
  FieldValues,
  UseFormReturn,
} from "react-hook-form";

interface MutateOptions<TData> {
  onSuccess?: (data: TData) => void;
}

interface MutationLike<TVariables, TData> {
  isPending: boolean;
  mutate: (variables: TVariables, options?: MutateOptions<TData>) => void;
}

interface UseMutationFormOptions<
  TValues extends FieldValues,
  TVariables,
  TData,
> {
  form: UseFormReturn<TValues>;
  mutation: MutationLike<TVariables, TData>;
  onClose: () => void;
  resetOnSuccess?: boolean;
  resetWhen?: {
    key: unknown;
    open: boolean;
    values: DefaultValues<TValues>;
  };
  toVariables: (values: TValues) => TVariables;
}

interface UseMutationFormResult {
  isPending: boolean;
  submit: (e?: React.BaseSyntheticEvent) => void;
}

export function useMutationForm<
  TValues extends FieldValues,
  TVariables,
  TData,
>({
  form,
  mutation,
  toVariables,
  onClose,
  resetOnSuccess = false,
  resetWhen,
}: UseMutationFormOptions<TValues, TVariables, TData>): UseMutationFormResult {
  const resetOpen = resetWhen?.open;
  const resetKey = resetWhen?.key;
  const resetValuesRef = useRef(resetWhen?.values);
  resetValuesRef.current = resetWhen?.values;

  // biome-ignore lint/correctness/useExhaustiveDependencies: values read via ref; form is stable.
  useEffect(() => {
    if (!resetOpen) {
      return;
    }
    const values = resetValuesRef.current;
    if (values) {
      form.reset(values);
    }
  }, [resetOpen, resetKey]);

  const submit = form.handleSubmit((values) => {
    mutation.mutate(toVariables(values), {
      onSuccess: () => {
        if (resetOnSuccess) {
          form.reset();
        }
        onClose();
      },
    });
  });

  return {
    submit,
    isPending: mutation.isPending,
  };
}
