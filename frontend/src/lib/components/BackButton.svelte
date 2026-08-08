<script lang="ts">
  import { goto } from '$app/navigation';
  import { locale, tr } from '$lib/i18n.js';
  // href → navigate there; omitted → browser history back.
  let { href, label }: { href?: string; label?: string } = $props();
  function go() { if (href) goto(href); else history.back(); }
</script>

<button type="button" class="btn-ghost -ms-2 gap-1 px-2 text-sm" onclick={go}>
  <svg class="rtl-flip h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
  {label ?? tr({ en: 'Back', ar: 'رجوع' }, $locale)}
</button>
