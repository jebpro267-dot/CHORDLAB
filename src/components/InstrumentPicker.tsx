import { Guitar } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INSTRUMENTS } from "@/lib/instruments";

interface Props {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  className?: string;
}

/**
 * Dropdown selector component for picking an active instrument (Guitar, Ukulele, Piano, etc.).
 *
 * @param props - Component props containing current instrument ID, change handler, and optional label.
 * @returns React JSX element rendering the instrument picker.
 */
export function InstrumentPicker({ value, onChange, label = "Instrument", className }: Props) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <Guitar className="size-4 text-muted-foreground" />
        <span className="text-sm">{label}</span>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="ml-auto w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INSTRUMENTS.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
