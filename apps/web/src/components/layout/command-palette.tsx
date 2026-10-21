import { useEffect, useState } from 'react';
import { Moon, Plus, Search, Sparkles, Sun, Upload } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { useTheme } from '@/hooks/use-theme';
import { MAIN_NAV } from '@/lib/nav';

/** The palette's contents mount only while it is open, so the search box always starts empty. */
function PaletteBody({ onOpenChange, onAdd }: { onOpenChange: (o: boolean) => void; onAdd: () => void }) {
  const navigate = useNavigate();
  const { resolved, setTheme } = useTheme();
  const [query, setQuery] = useState('');

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <Command shouldFilter>
      <CommandInput placeholder="Search transactions, pages and actions…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {query.trim().length >= 2 && (
          <CommandGroup heading="Search">
            <CommandItem forceMount value={`search ${query}`} onSelect={() => go(`/transactions?q=${encodeURIComponent(query.trim())}`)}>
              <Search /> Find transactions matching “{query.trim()}”
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Go to">
          {MAIN_NAV.map((n) => (
            <CommandItem key={n.to} value={`go ${n.label}`} onSelect={() => go(n.to)}>
              <n.icon /> {n.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem
            value="add transaction new expense"
            onSelect={() => {
              onOpenChange(false);
              onAdd();
            }}
          >
            <Plus /> Add a transaction
          </CommandItem>
          <CommandItem value="import statement upload csv" onSelect={() => go('/import')}>
            <Upload /> Import a statement
          </CommandItem>
          <CommandItem value="ask coach question ai" onSelect={() => go('/coach')}>
            <Sparkles /> Ask the Money Coach
          </CommandItem>
          <CommandItem
            value="toggle theme dark light"
            onSelect={() => {
              setTheme(resolved === 'dark' ? 'light' : 'dark');
              onOpenChange(false);
            }}
          >
            {resolved === 'dark' ? <Sun /> : <Moon />} Switch to {resolved === 'dark' ? 'light' : 'dark'} theme
            <CommandShortcut>Theme</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** ⌘K / Ctrl+K: jump anywhere, run a quick action, or search transactions. */
export function CommandPalette({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search or jump to" description="Search transactions, jump to a page, or run an action">
      <PaletteBody onOpenChange={onOpenChange} onAdd={onAdd} />
    </CommandDialog>
  );
}
