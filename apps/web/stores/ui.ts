'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Column keys the leads table can show; order here is the display order. */
export const LEAD_COLUMNS = [
  'business',
  'location',
  'score',
  'opportunity',
  'verification',
  'contactability',
  'website',
  'social',
  'channel',
  'status',
  'activity',
] as const;
export type LeadColumn = (typeof LEAD_COLUMNS)[number];

export const DEFAULT_LEAD_COLUMNS: LeadColumn[] = [
  'business',
  'location',
  'score',
  'opportunity',
  'verification',
  'website',
  'status',
  'activity',
];

export interface SavedFilter {
  id: string;
  name: string;
  params: Record<string, string | number | undefined>;
}

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  leadColumns: LeadColumn[];
  savedFilters: SavedFilter[];
  toggleSidebar: () => void;
  setSidebarCollapsed: (value: boolean) => void;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setLeadColumns: (columns: LeadColumn[]) => void;
  toggleLeadColumn: (column: LeadColumn) => void;
  saveFilter: (filter: SavedFilter) => void;
  removeFilter: (id: string) => void;
}

/**
 * Per-viewer UI preferences. Persisted to localStorage so the workspace feels
 * remembered; nothing here is business data.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandPaletteOpen: false,
      leadColumns: DEFAULT_LEAD_COLUMNS,
      savedFilters: [],
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      openMobileNav: () => set({ mobileNavOpen: true }),
      closeMobileNav: () => set({ mobileNavOpen: false }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setLeadColumns: (columns) => set({ leadColumns: columns }),
      toggleLeadColumn: (column) =>
        set((s) => ({
          leadColumns: s.leadColumns.includes(column)
            ? s.leadColumns.filter((c) => c !== column)
            : LEAD_COLUMNS.filter((c) => s.leadColumns.includes(c) || c === column),
        })),
      saveFilter: (filter) =>
        set((s) => ({
          savedFilters: [...s.savedFilters.filter((f) => f.id !== filter.id), filter],
        })),
      removeFilter: (id) =>
        set((s) => ({ savedFilters: s.savedFilters.filter((f) => f.id !== id) })),
    }),
    {
      name: 'leadforge.ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        leadColumns: state.leadColumns,
        savedFilters: state.savedFilters,
      }),
    },
  ),
);
