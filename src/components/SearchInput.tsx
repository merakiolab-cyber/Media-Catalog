"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  iconSize = 16,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  iconSize?: number;
}) {
  const hasValue = value.length > 0;

  return (
    <div className={cn("relative", className)}>
      <MagnifyingGlass
        size={iconSize}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
      />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "pl-9",
          hasValue && "pr-9",
          inputClassName
        )}
      />
      {hasValue && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 size-6"
          onClick={() => onChange("")}
          aria-label="Vymazat hledání"
        >
          <X size={iconSize - 2} weight="bold" />
        </Button>
      )}
    </div>
  );
}
