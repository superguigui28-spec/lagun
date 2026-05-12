import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import { Dispatch, SetStateAction, useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";

interface AnimateChangeInHeightProps {
  children: React.ReactNode;
  className?: string;
}

export const AnimateChangeInHeight: React.FC<AnimateChangeInHeightProps> = ({
  children,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        const observedHeight = entries[0].contentRect.height;
        setHeight(observedHeight);
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  return (
    <motion.div
      className={cn("overflow-hidden", className)}
      style={{ height }}
      animate={{ height }}
      transition={{ duration: 0.1, ease: "easeOut" }}
    >
      <div ref={containerRef}>{children}</div>
    </motion.div>
  );
};

export interface FilterOption {
  name: string;
  icon?: React.ReactNode;
  label?: string;
}

export interface Filter {
  id: string;
  type: string;
  operator: string;
  value: string[];
}

const FilterOperatorDropdown = ({
  operator,
  operators,
  setOperator,
}: {
  operator: string;
  operators: string[];
  setOperator: (operator: string) => void;
}) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-muted hover:bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded text-xs transition cursor-pointer">
        {operator}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[120px]">
        {operators.map((op) => (
          <DropdownMenuItem key={op} onClick={() => setOperator(op)}>
            {op}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const FilterValueCombobox = ({
  filterType,
  options,
  filterValues,
  setFilterValues,
}: {
  filterType: string;
  options: FilterOption[];
  filterValues: string[];
  setFilterValues: (filterValues: string[]) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const nonSelected = options.filter((o) => !filterValues.includes(o.name));

  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) setTimeout(() => setCommandInput(""), 200);
      }}
    >
      <PopoverTrigger className="bg-muted hover:bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded text-xs transition cursor-pointer flex items-center gap-1">
        {filterValues?.length === 1
          ? filterValues[0]
          : `${filterValues?.length} selecionados`}
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <AnimateChangeInHeight>
          <Command>
            <CommandInput
              placeholder="Buscar..."
              value={commandInput}
              onChangeCapture={(e: React.FormEvent<HTMLInputElement>) =>
                setCommandInput(e.currentTarget.value)
              }
              ref={commandInputRef}
            />
            <CommandList>
              <CommandEmpty>Sem resultados.</CommandEmpty>
              <CommandGroup>
                {filterValues.map((value) => (
                  <CommandItem
                    key={value}
                    value={value}
                    onSelect={() => {
                      setFilterValues(filterValues.filter((v) => v !== value));
                      setTimeout(() => setCommandInput(""), 200);
                      setOpen(false);
                    }}
                  >
                    <Check className="mr-2 h-4 w-4 text-primary" />
                    {value}
                  </CommandItem>
                ))}
              </CommandGroup>
              {nonSelected.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    {nonSelected.map((filter) => (
                      <CommandItem
                        key={filter.name}
                        value={filter.name}
                        onSelect={(currentValue) => {
                          setFilterValues([...filterValues, currentValue]);
                          setTimeout(() => setCommandInput(""), 200);
                          setOpen(false);
                        }}
                      >
                        <Checkbox checked={false} className="mr-2" />
                        {filter.icon}
                        <span className="text-foreground">{filter.name}</span>
                        {filter.label && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {filter.label}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </AnimateChangeInHeight>
      </PopoverContent>
    </Popover>
  );
};

export default function Filters({
  filters,
  setFilters,
  optionsMap,
  operatorsMap,
}: {
  filters: Filter[];
  setFilters: Dispatch<SetStateAction<Filter[]>>;
  optionsMap: Record<string, FilterOption[]>;
  operatorsMap?: Record<string, string[]>;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {filters
        .filter((filter) => filter.value?.length > 0)
        .map((filter) => (
          <div
            key={filter.id}
            className="flex items-center gap-1 rounded-md border border-border bg-card text-card-foreground h-7 px-1 text-xs"
          >
            <div className="flex items-center gap-1 text-muted-foreground font-medium px-1">
              {filter.type}
            </div>
            <FilterOperatorDropdown
              operator={filter.operator}
              operators={operatorsMap?.[filter.type] ?? ["é", "não é"]}
              setOperator={(operator) => {
                setFilters((prev) =>
                  prev.map((f) =>
                    f.id === filter.id ? { ...f, operator } : f
                  )
                );
              }}
            />
            <FilterValueCombobox
              filterType={filter.type}
              options={optionsMap[filter.type] ?? []}
              filterValues={filter.value}
              setFilterValues={(filterValues) => {
                setFilters((prev) =>
                  prev.map((f) =>
                    f.id === filter.id ? { ...f, value: filterValues } : f
                  )
                );
              }}
            />
            <Button
              variant="ghost"
              onClick={() =>
                setFilters((prev) => prev.filter((f) => f.id !== filter.id))
              }
              className="bg-muted rounded-l-none rounded-r-sm h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition shrink-0 p-0"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
    </div>
  );
}
