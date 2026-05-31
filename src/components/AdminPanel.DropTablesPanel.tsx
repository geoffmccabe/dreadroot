import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronDown, Trash2, Plus, Save, Copy } from 'lucide-react';
import { getItemSpriteUrl } from '@/lib/itemSprite';

interface DropTable {
  id: string;
  code: string;
  name: string;
}

interface DropTableEntry {
  id: string;
  drop_table_id: string;
  item_number: number;
  item_name: string;
  weight: number;
  sort_order: number;
}

function DropTableSpreadsheet({
  entries,
  onChange,
}: {
  entries: DropTableEntry[];
  onChange: (entries: DropTableEntry[]) => void;
}) {
  const currentTotal = entries.reduce((sum, e) => sum + e.weight, 0);

  const handleWeightChange = (index: number, value: string) => {
    const newWeight = parseInt(value) || 0;
    const updated = [...entries];
    updated[index] = { ...updated[index], weight: newWeight };
    onChange(updated);
  };

  const handleNameChange = (index: number, value: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], item_name: value };
    onChange(updated);
  };

  const handleRemove = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Item Name</TableHead>
          <TableHead className="w-20">Item ID</TableHead>
          <TableHead className="w-36">Weight</TableHead>
          <TableHead className="w-28">% Chance</TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry, i) => {
          const pct = currentTotal > 0 ? (entry.weight / currentTotal) * 100 : 0;
          return (
            <TableRow key={entry.id}>
              <TableCell className="text-xs text-muted-foreground py-1">{i + 1}</TableCell>
              <TableCell className="py-1">
                <Input
                  value={entry.item_name}
                  onChange={(e) => handleNameChange(i, e.target.value)}
                  className="h-7 text-xs"
                />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground py-1">
                {entry.item_number}
              </TableCell>
              <TableCell className="py-1">
                <Input
                  type="number"
                  value={entry.weight}
                  onChange={(e) => handleWeightChange(i, e.target.value)}
                  className="h-7 text-xs w-full"
                />
              </TableCell>
              <TableCell className="text-xs font-mono py-1">
                {pct < 0.0001 ? pct.toExponential(2) : pct < 1 ? pct.toFixed(4) : pct.toFixed(2)}%
              </TableCell>
              <TableCell className="py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => handleRemove(i)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3} className="text-xs font-medium">
            Total ({entries.length} items)
          </TableCell>
          <TableCell className="text-xs font-mono">{currentTotal.toLocaleString()}</TableCell>
          <TableCell className="text-xs font-mono">100%</TableCell>
          <TableCell></TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function DropTableCard({
  table,
  entries,
  onEntriesChange,
  onSave,
  hasChanges,
}: {
  table: DropTable;
  entries: DropTableEntry[];
  onEntriesChange: (tableId: string, entries: DropTableEntry[]) => void;
  onSave: (tableId: string) => void;
  hasChanges: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);

  const handleAddEntry = () => {
    const newEntry: DropTableEntry = {
      id: `temp-${Date.now()}`,
      drop_table_id: table.id,
      item_number: 0,
      item_name: 'New Item',
      weight: 1000000,
      sort_order: entries.length,
    };
    onEntriesChange(table.id, [...entries, newEntry]);
  };

  return (
    <Card className="mb-4">
      <CardHeader
        className="cursor-pointer py-3 px-4"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{table.code}</Badge>
            <CardTitle className="text-sm">{table.name || table.code}</CardTitle>
            <span className="text-xs text-muted-foreground">
              ({entries.length} items)
            </span>
            {hasChanges && (
              <Badge variant="destructive" className="text-[10px] px-1 py-0">
                unsaved
              </Badge>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
          />
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="pt-0 px-4">
          <DropTableSpreadsheet
            entries={entries}
            onChange={(updated) => onEntriesChange(table.id, updated)}
          />
          <div className="flex gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={handleAddEntry}>
              <Plus className="h-3 w-3 mr-1" />
              Add Item
            </Button>
            {hasChanges && (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onSave(table.id);
                }}
              >
                <Save className="h-3 w-3 mr-1" />
                Save
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function DropTablesPanel() {
  const [dropTables, setDropTables] = useState<DropTable[]>([]);
  const [entriesByTable, setEntriesByTable] = useState<Map<string, DropTableEntry[]>>(new Map());
  const [changedTables, setChangedTables] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [showAddNew, setShowAddNew] = useState(false);
  const [cloneFromId, setCloneFromId] = useState<string>('');
  const [newTableName, setNewTableName] = useState('');

  const loadData = useCallback(async () => {
    setIsLoading(true);

    const { data: tables, error: tablesErr } = await supabase
      .from('drop_tables')
      .select('id, code, name')
      .order('code');

    if (tablesErr) {
      console.error('[DropTables] Failed to load tables:', tablesErr);
      toast.error('Failed to load drop tables');
      setIsLoading(false);
      return;
    }

    setDropTables(tables || []);

    const { data: entries, error: entriesErr } = await supabase
      .from('drop_table_entries')
      .select('id, drop_table_id, item_number, item_name, weight, sort_order')
      .order('sort_order');

    if (entriesErr) {
      console.error('[DropTables] Failed to load entries:', entriesErr);
      toast.error('Failed to load drop table entries');
      setIsLoading(false);
      return;
    }

    const grouped = new Map<string, DropTableEntry[]>();
    for (const entry of entries || []) {
      const list = grouped.get(entry.drop_table_id) || [];
      list.push(entry);
      grouped.set(entry.drop_table_id, list);
    }
    setEntriesByTable(grouped);
    setChangedTables(new Set());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleEntriesChange = (tableId: string, entries: DropTableEntry[]) => {
    setEntriesByTable((prev) => {
      const next = new Map(prev);
      next.set(tableId, entries);
      return next;
    });
    setChangedTables((prev) => new Set(prev).add(tableId));
  };

  const handleSave = async (tableId: string) => {
    const entries = entriesByTable.get(tableId) || [];

    // Delete existing entries
    const { error: delErr } = await supabase
      .from('drop_table_entries')
      .delete()
      .eq('drop_table_id', tableId);

    if (delErr) {
      toast.error('Failed to save: could not clear old entries');
      return;
    }

    // Insert updated entries
    const rows = entries.map((e, i) => ({
      drop_table_id: tableId,
      item_number: e.item_number,
      item_name: e.item_name,
      weight: e.weight,
      sort_order: i,
    }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase
        .from('drop_table_entries')
        .insert(rows);

      if (insErr) {
        toast.error('Failed to save drop table entries');
        return;
      }
    }

    // Sync each drop table entry to the items table by item_number
    for (const entry of entries) {
      if (!entry.item_number || entry.item_number <= 0) continue;

      const { data: existingItem } = await supabase
        .from('items')
        .select('id, name, texture_url')
        .eq('item_number', entry.item_number)
        .maybeSingle();

      const spriteUrl = getItemSpriteUrl({ item_number: entry.item_number });

      if (!existingItem) {
        // Create item from drop table entry
        const key = entry.item_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        await supabase.from('items').insert({
          key: `drop_${entry.item_number}_${key}`,
          name: entry.item_name,
          item_number: entry.item_number,
          item_category: 'siege_worlds',
          rarity: 'common',
          tier: 1,
          cost: 0,
          class: 'material',
          texture_url: spriteUrl,
        });
      } else {
        // Update name and texture_url if needed
        const updates: Record<string, string | null> = {};
        if (existingItem.name !== entry.item_name) updates.name = entry.item_name;
        if (spriteUrl && existingItem.texture_url !== spriteUrl) updates.texture_url = spriteUrl;
        if (Object.keys(updates).length > 0) {
          await supabase.from('items').update(updates).eq('id', existingItem.id);
        }
      }
    }

    toast.success(`${dropTables.find((t) => t.id === tableId)?.code || 'Table'} saved`);
    setChangedTables((prev) => {
      const next = new Set(prev);
      next.delete(tableId);
      return next;
    });

    // Reload to get fresh IDs
    loadData();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Loading drop tables...</p>
        </CardContent>
      </Card>
    );
  }

  if (dropTables.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">No drop tables found. Run the migration to seed DT1.</p>
        </CardContent>
      </Card>
    );
  }

  const handleAddNewTable = async () => {
    if (!cloneFromId) {
      toast.error('Select a drop table to clone from');
      return;
    }

    const sourceTable = dropTables.find((t) => t.id === cloneFromId);
    if (!sourceTable) return;

    // Generate next code: DT1 -> DT2, DT2 -> DT3, etc.
    const existingCodes = dropTables.map((t) => t.code);
    let nextNum = dropTables.length + 1;
    while (existingCodes.includes(`DT${nextNum}`)) nextNum++;
    const newCode = `DT${nextNum}`;

    const { data: newTable, error: createErr } = await supabase
      .from('drop_tables')
      .insert({ code: newCode, name: newTableName || `${newCode}` })
      .select('id, code, name')
      .single();

    if (createErr || !newTable) {
      toast.error('Failed to create drop table');
      return;
    }

    // Clone entries from source
    const sourceEntries = entriesByTable.get(cloneFromId) || [];
    if (sourceEntries.length > 0) {
      const clonedRows = sourceEntries.map((e, i) => ({
        drop_table_id: newTable.id,
        item_number: e.item_number,
        item_name: e.item_name,
        weight: e.weight,
        sort_order: i,
      }));

      const { error: cloneErr } = await supabase
        .from('drop_table_entries')
        .insert(clonedRows);

      if (cloneErr) {
        toast.error('Table created but failed to clone entries');
      }
    }

    toast.success(`${newCode} created from ${sourceTable.code}`);
    setShowAddNew(false);
    setCloneFromId('');
    setNewTableName('');
    loadData();
  };

  return (
    <div className="space-y-2">
      {dropTables.map((table) => (
        <DropTableCard
          key={table.id}
          table={table}
          entries={entriesByTable.get(table.id) || []}
          onEntriesChange={handleEntriesChange}
          onSave={handleSave}
          hasChanges={changedTables.has(table.id)}
        />
      ))}

      {showAddNew ? (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Clone from</span>
              <Select value={cloneFromId} onValueChange={setCloneFromId}>
                <SelectTrigger className="w-48 h-8 text-xs">
                  <SelectValue placeholder="Select a drop table..." />
                </SelectTrigger>
                <SelectContent>
                  {dropTables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.code} — {t.name || t.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Name (optional)</span>
              <Input
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder="e.g. Boss Drop Table"
                className="w-48 h-8 text-xs"
              />
            </div>
            <div className="flex items-end gap-2 pt-4">
              <Button size="sm" onClick={handleAddNewTable}>
                <Copy className="h-3 w-3 mr-1" />
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddNew(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setShowAddNew(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add New Drop Table
        </Button>
      )}
    </div>
  );
}
