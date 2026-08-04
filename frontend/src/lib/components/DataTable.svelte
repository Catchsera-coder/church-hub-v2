<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '$lib/i18n.js';

  let {
    headers = [],
    rows = [],
    loading = false,
    empty = '',
    row,
  }: {
    headers?: string[];
    rows?: any[];
    loading?: boolean;
    empty?: string;
    row: Snippet<[any]>;
  } = $props();
</script>

<div class="card overflow-x-auto">
  {#if loading}
    <p class="p-6 text-slate-400">{$t('common.loading')}</p>
  {:else if rows.length === 0}
    <p class="p-8 text-center text-slate-500">{empty || $t('common.none')}</p>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 text-slate-500 dark:border-slate-800">
        <tr>
          {#each headers as h}
            <th class="p-3 text-start font-medium">{h}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as item}
          <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
            {@render row(item)}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
