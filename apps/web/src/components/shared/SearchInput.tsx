import { SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

interface SearchInputProps {
  /** The search in effect (usually from the address bar). */
  value: string;
  onSearch: (text: string) => void;
  label: string;
  placeholder?: string;
  /** Milliseconds of quiet typing before searching, so the server is not asked at every key. */
  delay?: number;
}

/** A search box that waits for the person to stop typing (F12). */
export function SearchInput({
  value,
  onSearch,
  label,
  placeholder,
  delay = 300,
}: SearchInputProps) {
  const [text, setText] = useState(value);
  // The search can change from outside (back button, a link): show it.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }

  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onSearch(text.trim()), delay);
    return () => clearTimeout(timer);
  }, [text, value, delay, onSearch]);

  return (
    <div className="relative w-full max-w-xs">
      <SearchIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        className="pl-8"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </div>
  );
}
