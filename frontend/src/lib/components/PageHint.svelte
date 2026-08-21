<script lang="ts">
  import { locale, tr } from '$lib/i18n.js';
  import { pageTips, dismissedHints, dismissHint } from '$lib/stores/prefs.js';

  // A small, dismissible "how to use this page" banner. Give each a stable `id`
  // so a dismissal is remembered. Hidden entirely when the user turns page tips
  // off in Settings; re-shown when they reset tips. `title`/`text` are i18n maps.
  let { id, title = null, text, icon = '💡' }:
    { id: string; title?: Record<string, string> | null; text: Record<string, string>; icon?: string } = $props();

  const visible = $derived($pageTips === 'on' && !$dismissedHints.includes(id));
</script>

{#if visible}
  <div class="mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm"
    style="border-color: color-mix(in srgb, var(--brand) 30%, transparent); background: color-mix(in srgb, var(--brand) 8%, transparent)">
    <span class="mt-0.5 shrink-0 text-base">{icon}</span>
    <div class="min-w-0 flex-1">
      {#if title}<p class="font-medium text-slate-800 dark:text-slate-100">{tr(title, $locale)}</p>{/if}
      <p class="text-slate-600 dark:text-slate-300">{tr(text, $locale)}</p>
    </div>
    <button class="shrink-0 rounded-md p-1 text-slate-400 hover:bg-black/5 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
      title={tr({ en: 'Dismiss (manage tips in Settings)', ar: 'إخفاء (تُدار التلميحات من الإعدادات)' }, $locale)}
      aria-label="Dismiss" onclick={() => dismissHint(id)}>✕</button>
  </div>
{/if}
