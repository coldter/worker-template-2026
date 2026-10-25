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

export const useMutationForm = <
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
}: UseMutationFormOptions<
  TValues,
  TVariables,
  TData
>): UseMutationFormResult => {
  const resetOpen = resetWhen?.open;
  const resetKey = resetWhen?.key;
  const resetValues = resetWhen?.values;

  const previousResetRef = useRef<{ key: unknown; open: boolean }>({
    key: resetKey,
    open: false,
  });

  useEffect(() => {
    const { key, open } = previousResetRef.current;
    const opened = resetOpen && !open;
    const keyChanged = resetKey !== key;

    previousResetRef.current = { key: resetKey, open: Boolean(resetOpen) };

    if (!(opened || (resetOpen && keyChanged)) || !resetValues) {
      return;
    }

    form.reset(resetValues);
  }, [form, resetKey, resetOpen, resetValues]);

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
    isPending: mutation.isPending,
    submit,
  };
};
