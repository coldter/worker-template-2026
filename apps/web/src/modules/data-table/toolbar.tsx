import { Cross2Icon } from "@radix-ui/react-icons";
import type { ReactTable, RowData } from "@tanstack/react-table";
import { useEffect, useEffectEvent, useState } from "react";

import { Button } from "@/modules/ui/button";
import { Input } from "@/modules/ui/input";

import { DataTableFacetedFilter } from "./faceted-filter";
import type { DataTableFeatures } from "./features";
import { DataTableViewOptions } from "./view-options";

const SEARCH_DEBOUNCE_MS = 300;

interface DebouncedInputProps {
  "aria-label": string;
  className?: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  value: string;
}

const DebouncedInput = ({
  onValueChange,
  value,
  ...props
}: DebouncedInputProps) => {
  const [input, setInput] = useState({ local: value, synced: value });
  const commit = useEffectEvent((next: string) => onValueChange(next));

  if (value !== input.synced) {
    setInput({ local: value, synced: value });
  }

  const localValue = value === input.synced ? input.local : value;

  useEffect(() => {
    if (localValue === value) {
      return;
    }

    const timer = setTimeout(() => commit(localValue), SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [localValue, value]);

  return (
    <Input
      {...props}
      onChange={(event) => {
        setInput({ local: event.target.value, synced: value });
      }}
      value={localValue}
    />
  );
};

interface DataTableFilter {
  columnId: string;
  title: string;
  options: {
    label: string;
    value: string;
    icon?: React.ComponentType<{ className?: string }>;
  }[];
}

const EMPTY_FILTERS: DataTableFilter[] = [];

interface DataTableToolbarProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>;
  searchPlaceholder?: string;
  searchKey?: string;
  filters?: DataTableFilter[];
}

export const DataTableToolbar = <TData extends RowData>({
  table,
  searchPlaceholder = "Filter...",
  searchKey,
  filters = EMPTY_FILTERS,
}: DataTableToolbarProps<TData>) => {
  const isFiltered =
    table.state.columnFilters.length > 0 || table.state.globalFilter;

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 flex-col-reverse items-start gap-y-2 sm:flex-row sm:items-center sm:space-x-2">
        {searchKey ? (
          <DebouncedInput
            aria-label={searchPlaceholder}
            className="h-8 w-[150px] lg:w-[250px]"
            onValueChange={(value) =>
              table.getColumn(searchKey)?.setFilterValue(value)
            }
            placeholder={searchPlaceholder}
            value={String(table.getColumn(searchKey)?.getFilterValue() ?? "")}
          />
        ) : (
          <DebouncedInput
            aria-label={searchPlaceholder}
            className="h-8 w-[150px] lg:w-[250px]"
            onValueChange={(value) => table.setGlobalFilter(value)}
            placeholder={searchPlaceholder}
            value={table.state.globalFilter ?? ""}
          />
        )}
        <div className="flex gap-x-2">
          {filters.map((filter) => {
            const column = table.getColumn(filter.columnId);

            if (!column) {
              return null;
            }

            return (
              <DataTableFacetedFilter
                column={column}
                key={filter.columnId}
                options={filter.options}
                title={filter.title}
              />
            );
          })}
        </div>
        {isFiltered ? (
          <Button
            className="h-8 px-2 lg:px-3"
            onClick={() => {
              table.resetColumnFilters();
              table.setGlobalFilter("");
            }}
            variant="ghost"
          >
            Reset
            <Cross2Icon className="ms-2 h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <DataTableViewOptions table={table} />
    </div>
  );
};
