<script lang="ts">
  import type { Snippet } from 'svelte';
  import { locale, tr } from '$lib/i18n.js';

  // Presentational filter panel. The page owns the filter state and passes the
  // count of active filters + a clear handler; controls go in the children slot.
  let { active = 0, onclear, children }: { active?: number; onclear?: () => void; children: Snippet } = $props();
  let open = $state(active > 0);
</script>

<div class="mb-4">
  <div class="flex items-center gap-3">
    <button class="btn-ghost gap-2 border border-slate-300 text-sm dark:border-slate-700" onclick={() => (open = !open)}>
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
      {tr({ en: 'Filters', ar: 'المرشحات' }, $locale)}{#if active > 0} ({active}){/if}
      <span class="text-slate-400">{open ? '▾' : '▸'}</span>
    </button>
    {#if active > 0}
      <button class="text-sm text-slate-500 hover:underline" onclick={onclear}>{tr({ en: 'Clear all', ar: 'مسح الكل' }, $locale)}</button>
    {/if}
  </div>
  {#if open}
    <div class="card mt-2 flex flex-wrap items-end gap-3 p-4">{@render children()}</div>
  {/if}
</div>
