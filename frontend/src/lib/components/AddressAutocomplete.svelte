<script lang="ts">
  import { api } from '$lib/api.js';
  import { locale, tr } from '$lib/i18n.js';

  // Address type-ahead. Proxies the backend (Azure Maps if configured, else free
  // Photon/OpenStreetMap). On pick it calls `onpick` with the parts so the parent
  // form auto-fills line1/city/region/postalCode/country. No AI.
  let { onpick }: { onpick: (a: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string }) => void } = $props();

  let q = $state('');
  let results = $state<any[]>([]);
  let open = $state(false);
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  function search() {
    clearTimeout(timer);
    if (q.trim().length < 3) { results = []; open = false; return; }
    loading = true;
    timer = setTimeout(async () => {
      try { results = (await api<{ data: any[] }>(`/geo/autocomplete?q=${encodeURIComponent(q.trim())}`)).data; open = true; }
      catch { results = []; } finally { loading = false; }
    }, 300);
  }
  function pick(a: any) {
    onpick({ line1: a.line1 || '', line2: a.line2 || '', city: a.city || '', region: a.region || '', postalCode: a.postalCode || '', country: a.country || '' });
    q = ''; results = []; open = false;
  }
</script>

<div class="relative">
  <label class="block space-y-1">
    <span class="text-sm text-slate-600 dark:text-slate-300">🔎 {tr({ en: 'Find address', ar: 'ابحث عن عنوان' }, $locale)}</span>
    <input class="input" bind:value={q} oninput={search} onfocus={() => { if (results.length) open = true; }}
      placeholder={tr({ en: 'Start typing an address…', ar: 'ابدأ بكتابة العنوان…' }, $locale)} autocomplete="off" />
  </label>
  {#if open && (results.length || loading)}
    <div class="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {#if loading && !results.length}
        <p class="px-3 py-2 text-xs text-slate-400">{tr({ en: 'Searching…', ar: 'جارٍ البحث…' }, $locale)}</p>
      {/if}
      {#each results as a}
        <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onclick={() => pick(a)}>{a.label}</button>
      {/each}
    </div>
  {/if}
  <p class="mt-1 text-xs text-slate-400">{tr({ en: 'Pick a match to auto-fill the fields below, or type them manually.', ar: 'اختر نتيجة لملء الحقول تلقائياً، أو اكتبها يدوياً.' }, $locale)}</p>
</div>
