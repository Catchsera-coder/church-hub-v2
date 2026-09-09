<script lang="ts">
  import { pageSize } from '$lib/stores/prefs.js';
  import { locale, tr } from '$lib/i18n.js';

  // Global per-page row-count control. Bound to the device-level `pageSize` pref
  // so the choice sticks across pages and sessions. Parent passes `onchange` to
  // reset to page 1 and reload with the new limit.
  let { onchange }: { onchange?: () => void } = $props();
</script>

<label class="flex items-center gap-2 text-sm text-slate-500">
  <span>{tr({ en: 'Show', ar: 'إظهار' }, $locale)}</span>
  <select class="input w-auto py-1 text-sm" bind:value={$pageSize} onchange={() => onchange?.()}>
    <option value="25">25</option>
    <option value="50">50</option>
    <option value="100">100</option>
    <option value="all">{tr({ en: 'All', ar: 'الكل' }, $locale)}</option>
  </select>
</label>
